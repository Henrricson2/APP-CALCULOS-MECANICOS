"""
Interfaz gráfica (Tkinter) del programa de cálculos mecánicos / plantillado.

Mejoras frente al original:
  * Diseño con grid/pack adaptable a cualquier resolución (antes: coordenadas
    fijas para 1920×1080 y botones fuera de pantalla en portátiles).
  * Sin variables globales: el estado vive en la clase App.
  * Todos los parámetros (conductor, hipótesis, criterios) son editables y se
    pueden guardar/cargar en JSON por proyecto.
  * Exportaciones deshabilitadas hasta que haya un cálculo válido; el usuario
    elige carpeta de salida.
  * Gráfica paginada con barra de zoom/desplazamiento de matplotlib.
  * Tablas de resultados y advertencias dentro de la aplicación.
"""
from __future__ import annotations

import os
import sys
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import matplotlib
matplotlib.use("TkAgg")
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk
from matplotlib.figure import Figure

from . import __version__
from .cambio_estado import ErrorCalculo
from .config import BIBLIOTECA_CONDUCTORES, Conductor, Proyecto
from .datos import DatosLinea, leer_datos
from .exportar import dibujar_perfil, exportar_dxf, exportar_excel, exportar_pdf, paginas
from .plantillado import ResultadoPlantillado, calcular_plantillado, tabla_secciones

CAMPOS_CONDUCTOR = [
    ("nombre", "Nombre / calibre", str),
    ("seccion_mm2", "Sección (mm²)", float),
    ("carga_rotura_kgf", "Carga de rotura (kgf)", float),
    ("peso_kgf_m", "Peso (kgf/m)", float),
    ("modulo_elasticidad", "Módulo E (kgf/mm²)", float),
    ("coef_dilatacion", "Coef. dilatación (1/°C)", float),
    ("diametro_mm", "Diámetro (mm)", float),
]
CAMPOS_CRITERIOS = [
    ("tension_kv", "Tensión nominal (kV)", float),
    ("distancia_minima_terreno_m", "Distancia mín. a terreno (m)", float),
    ("altura_amarre_defecto_m", "Altura amarre por defecto (m) [vacío = Y es amarre]", "opt"),
    ("long_cadena_aisladores_m", "Long. cadena aisladores (m)", float),
    ("fluencia_delta_t_c", "Fluencia: Δt equivalente (°C)", float),
    ("n_fases", "N° de fases", int),
    ("desperdicio_conductor", "Desperdicio conductor (fracción)", float),
]


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(f"Cálculos Mecánicos MT – Plantillado de catenarias  v{__version__}")
        self.geometry("1366x800")
        self.minsize(1000, 640)
        try:
            self.state("zoomed")          # Windows: maximizada (no pantalla completa)
        except tk.TclError:
            pass
        self.proyecto = Proyecto()
        self.datos: DatosLinea | None = None
        self.res: ResultadoPlantillado | None = None
        self.pagina = 0
        self.vars: dict[str, tk.Variable] = {}
        self._estilos()
        self._construir()
        self._cargar_proyecto_en_widgets()
        self.protocol("WM_DELETE_WINDOW", self._salir)
        self.bind("<Control-o>", lambda e: self.abrir_excel())
        self.bind("<F5>", lambda e: self.calcular())

    # ================================================================ estilo
    def _estilos(self):
        st = ttk.Style(self)
        if "vista" in st.theme_names():
            st.theme_use("vista")
        elif "clam" in st.theme_names():
            st.theme_use("clam")
        st.configure("Titulo.TLabel", font=("Segoe UI", 15, "bold"))
        st.configure("Accion.TButton", font=("Segoe UI", 10, "bold"), padding=6)
        st.configure("Treeview", rowheight=22)

    # ============================================================ construcción
    def _construir(self):
        # --- barra superior
        top = ttk.Frame(self, padding=(10, 8))
        top.pack(side="top", fill="x")
        ttk.Label(top, text="CÁLCULOS MECÁNICOS – LÍNEAS DE MEDIA TENSIÓN",
                  style="Titulo.TLabel").pack(side="left")
        ttk.Button(top, text="Salir", command=self._salir).pack(side="right", padx=4)
        self.btn_exportar = ttk.Button(top, text="Exportar…", style="Accion.TButton",
                                       command=self.exportar, state="disabled")
        self.btn_exportar.pack(side="right", padx=4)
        ttk.Button(top, text="Calcular (F5)", style="Accion.TButton",
                   command=self.calcular).pack(side="right", padx=4)
        ttk.Button(top, text="Abrir Excel… (Ctrl+O)", style="Accion.TButton",
                   command=self.abrir_excel).pack(side="right", padx=4)

        self.lbl_archivo = ttk.Label(self, text="Ningún archivo cargado", padding=(12, 0),
                                     foreground="#555")
        self.lbl_archivo.pack(side="top", fill="x")

        # --- barra de estado
        self.lbl_estado = ttk.Label(self, text="Listo.", relief="sunken", anchor="w", padding=4)
        self.lbl_estado.pack(side="bottom", fill="x")

        # --- cuerpo: panel de parámetros | resultados
        cuerpo = ttk.PanedWindow(self, orient="horizontal")
        cuerpo.pack(fill="both", expand=True, padx=8, pady=6)
        izq = ttk.Frame(cuerpo, padding=4)
        der = ttk.Frame(cuerpo)
        cuerpo.add(izq, weight=0)
        cuerpo.add(der, weight=1)
        self._panel_parametros(izq)
        self._panel_resultados(der)

    def _entrada(self, padre, fila, clave, etiqueta, ancho=14):
        ttk.Label(padre, text=etiqueta).grid(row=fila, column=0, sticky="w", pady=2, padx=(0, 6))
        v = tk.StringVar()
        ttk.Entry(padre, textvariable=v, width=ancho).grid(row=fila, column=1, sticky="ew", pady=2)
        self.vars[clave] = v

    def _panel_parametros(self, padre):
        nb = ttk.Notebook(padre, width=380)
        nb.pack(fill="both", expand=True)

        # --- conductor
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Conductor")
        ttk.Label(f, text="Biblioteca").grid(row=0, column=0, sticky="w")
        self.cmb_cond = ttk.Combobox(f, values=list(BIBLIOTECA_CONDUCTORES), state="readonly")
        self.cmb_cond.grid(row=0, column=1, sticky="ew", pady=4)
        self.cmb_cond.bind("<<ComboboxSelected>>", self._elegir_conductor)
        for i, (k, et, _) in enumerate(CAMPOS_CONDUCTOR, start=1):
            self._entrada(f, i, f"cond.{k}", et)
        ttk.Label(f, text="Si el Excel trae la hoja 'Tensionados', el conductor\n"
                          "se toma de allí automáticamente al abrirlo.",
                  foreground="#666").grid(row=20, column=0, columnspan=2, sticky="w", pady=8)
        f.columnconfigure(1, weight=1)

        # --- hipótesis
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Hipótesis")
        for j, t in enumerate(["Hipótesis", "T (°C)", "Viento (km/h)", "Hielo (kgf/m)", "Límite %rot"]):
            ttk.Label(f, text=t, font=("Segoe UI", 9, "bold")).grid(row=0, column=j, padx=3)
        for i, k in enumerate(self.proyecto.hipotesis, start=1):
            ttk.Label(f, text=k).grid(row=i, column=0, sticky="w")
            for j, campo in enumerate(["temperatura_c", "viento_kmh", "hielo_kgf_m", "limite"], start=1):
                v = tk.StringVar()
                ttk.Entry(f, textvariable=v, width=8).grid(row=i, column=j, padx=2, pady=2)
                self.vars[f"hip.{k}.{campo}"] = v
        r = len(self.proyecto.hipotesis) + 2
        ttk.Label(f, text="Modo de flecha").grid(row=r, column=0, columnspan=2, sticky="w", pady=(12, 2))
        self.vars["modo"] = tk.StringVar()
        ttk.Combobox(f, textvariable=self.vars["modo"], state="readonly", width=16,
                     values=["cambio_estado", "excel"]).grid(row=r, column=2, columnspan=3, sticky="w")
        ttk.Label(f, justify="left", foreground="#666", wraplength=340, text=(
            "cambio_estado (recomendado): tensión por vano regulador de cada sección "
            "de tendido y ecuación de cambio de estado.\n"
            "excel: usa la columna 'Flecha' del archivo (modo del programa original).\n\n"
            "Valores por defecto según EH-RAA-004 (Electrohuila): 0/20/50 °C, viento "
            "100 km/h, q = 0.0042·V². Límite vacío = solo verificación.")
                  ).grid(row=r + 1, column=0, columnspan=5, sticky="w", pady=6)

        # --- criterios
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Criterios")
        for i, (k, et, _) in enumerate(CAMPOS_CRITERIOS):
            self._entrada(f, i, f"crit.{k}", et, ancho=10)
        i = len(CAMPOS_CRITERIOS)
        self._entrada(f, i, "sal.vanos_por_pagina", "Vanos por página", ancho=10)
        self._entrada(f, i + 1, "sal.exageracion_vertical_dxf", "Exageración vertical DXF (1 = 1:1)", ancho=10)
        self._entrada(f, i + 2, "nombre", "Nombre del proyecto", ancho=24)
        b = ttk.Frame(f)
        b.grid(row=i + 4, column=0, columnspan=2, pady=12, sticky="w")
        ttk.Button(b, text="Guardar parámetros…", command=self.guardar_parametros).pack(side="left", padx=2)
        ttk.Button(b, text="Cargar parámetros…", command=self.cargar_parametros).pack(side="left", padx=2)
        ttk.Button(b, text="Restablecer", command=self.restablecer).pack(side="left", padx=2)
        f.columnconfigure(1, weight=1)

    def _panel_resultados(self, padre):
        self.nb_res = ttk.Notebook(padre)
        self.nb_res.pack(fill="both", expand=True)

        # --- perfil
        f = ttk.Frame(self.nb_res)
        self.nb_res.add(f, text="Perfil")
        nav = ttk.Frame(f, padding=4)
        nav.pack(side="top", fill="x")
        ttk.Button(nav, text="◀ Anterior", command=lambda: self._ir_pagina(-1)).pack(side="left")
        ttk.Button(nav, text="Siguiente ▶", command=lambda: self._ir_pagina(1)).pack(side="left", padx=4)
        self.lbl_pagina = ttk.Label(nav, text="")
        self.lbl_pagina.pack(side="left", padx=10)
        self.fig = Figure(figsize=(10, 6), dpi=100)
        self.ax = self.fig.add_subplot(111)
        self.canvas = FigureCanvasTkAgg(self.fig, master=f)
        NavigationToolbar2Tk(self.canvas, f).update()
        self.canvas.get_tk_widget().pack(fill="both", expand=True)
        self.ax.text(0.5, 0.5, "Abra un archivo de datos y pulse Calcular",
                     ha="center", va="center", transform=self.ax.transAxes, color="#888")
        self.ax.set_axis_off()

        # --- tablas
        self.tablas = {}
        for nombre in ("Resumen", "Secciones", "Vanos", "Apoyos"):
            fr = ttk.Frame(self.nb_res)
            self.nb_res.add(fr, text=nombre)
            tv = ttk.Treeview(fr, show="headings")
            sy = ttk.Scrollbar(fr, orient="vertical", command=tv.yview)
            sx = ttk.Scrollbar(fr, orient="horizontal", command=tv.xview)
            tv.configure(yscrollcommand=sy.set, xscrollcommand=sx.set)
            tv.grid(row=0, column=0, sticky="nsew")
            sy.grid(row=0, column=1, sticky="ns")
            sx.grid(row=1, column=0, sticky="ew")
            fr.rowconfigure(0, weight=1)
            fr.columnconfigure(0, weight=1)
            tv.tag_configure("alerta", background="#f8d7da")
            self.tablas[nombre] = tv

        fr = ttk.Frame(self.nb_res)
        self.nb_res.add(fr, text="Advertencias")
        self.txt_adv = tk.Text(fr, wrap="word", font=("Segoe UI", 10))
        self.txt_adv.pack(fill="both", expand=True)

    # =========================================================== parámetros
    def _cargar_proyecto_en_widgets(self):
        p = self.proyecto
        for k, _, _ in CAMPOS_CONDUCTOR:
            self.vars[f"cond.{k}"].set(str(getattr(p.conductor, k)))
        for k, h in p.hipotesis.items():
            if f"hip.{k}.temperatura_c" not in self.vars:
                continue
            self.vars[f"hip.{k}.temperatura_c"].set(str(h.temperatura_c))
            self.vars[f"hip.{k}.viento_kmh"].set(str(h.viento_kmh))
            self.vars[f"hip.{k}.hielo_kgf_m"].set(str(h.hielo_kgf_m))
            self.vars[f"hip.{k}.limite"].set("" if not h.limite_fraccion_rotura
                                             else f"{100 * h.limite_fraccion_rotura:g}")
        for k, _, _ in CAMPOS_CRITERIOS:
            v = getattr(p.criterios, k)
            self.vars[f"crit.{k}"].set("" if v is None else str(v))
        self.vars["sal.vanos_por_pagina"].set(str(p.salida.vanos_por_pagina))
        self.vars["sal.exageracion_vertical_dxf"].set(str(p.salida.exageracion_vertical_dxf))
        self.vars["modo"].set(p.modo_flecha)
        self.vars["nombre"].set(p.nombre)

    def _leer_widgets(self) -> Proyecto:
        """Construye el Proyecto desde la interfaz. Lanza ValueError con mensaje claro."""
        p = self.proyecto

        def num(clave, tipo=float, opcional=False):
            s = self.vars[clave].get().strip().replace(",", ".")
            if s == "" and opcional:
                return None
            try:
                return tipo(s)
            except ValueError:
                raise ValueError(f"Valor inválido en '{clave}': «{s}»") from None

        datos_c = {}
        for k, _, t in CAMPOS_CONDUCTOR:
            datos_c[k] = self.vars[f"cond.{k}"].get().strip() if t is str else num(f"cond.{k}")
        p.conductor = Conductor(**datos_c)
        for k, h in p.hipotesis.items():
            h.temperatura_c = num(f"hip.{k}.temperatura_c")
            h.viento_kmh = num(f"hip.{k}.viento_kmh")
            h.hielo_kgf_m = num(f"hip.{k}.hielo_kgf_m")
            lim = num(f"hip.{k}.limite", opcional=True)
            h.limite_fraccion_rotura = None if not lim else lim / 100.0
        for k, _, t in CAMPOS_CRITERIOS:
            setattr(p.criterios, k, num(f"crit.{k}", opcional=True) if t == "opt"
                    else num(f"crit.{k}", t))
        p.salida.vanos_por_pagina = max(1, num("sal.vanos_por_pagina", int))
        p.salida.exageracion_vertical_dxf = num("sal.exageracion_vertical_dxf")
        p.modo_flecha = self.vars["modo"].get()
        p.nombre = self.vars["nombre"].get().strip() or "Proyecto"
        return p

    def _elegir_conductor(self, _e=None):
        c = BIBLIOTECA_CONDUCTORES[self.cmb_cond.get()]
        for k, _, _ in CAMPOS_CONDUCTOR:
            self.vars[f"cond.{k}"].set(str(getattr(c, k)))

    def guardar_parametros(self):
        try:
            p = self._leer_widgets()
        except ValueError as e:
            return messagebox.showerror("Parámetros", str(e))
        ruta = filedialog.asksaveasfilename(defaultextension=".json",
                                            filetypes=[("Parámetros", "*.json")],
                                            initialfile="parametros_proyecto.json")
        if ruta:
            p.guardar_json(ruta)
            self._estado(f"Parámetros guardados en {ruta}")

    def cargar_parametros(self):
        ruta = filedialog.askopenfilename(filetypes=[("Parámetros", "*.json")])
        if not ruta:
            return
        try:
            self.proyecto = Proyecto.desde_json(ruta)
        except Exception as e:
            return messagebox.showerror("Parámetros", f"No se pudo leer el archivo:\n{e}")
        self._cargar_proyecto_en_widgets()
        self._estado(f"Parámetros cargados de {ruta}")

    def restablecer(self):
        self.proyecto = Proyecto()
        self._cargar_proyecto_en_widgets()

    # ================================================================ acciones
    def abrir_excel(self):
        ruta = filedialog.askopenfilename(title="Seleccionar archivo de datos",
                                          filetypes=[("Excel", "*.xlsx *.xlsm")])
        if not ruta:
            return
        try:
            crit = self._leer_widgets().criterios
        except ValueError as e:
            return messagebox.showerror("Parámetros", str(e))
        self.datos = leer_datos(ruta, crit)
        self.res = None
        self.btn_exportar.state(["disabled"])
        self.lbl_archivo.config(text=f"Archivo: {ruta}")
        if self.datos.conductor:
            for k, _, _ in CAMPOS_CONDUCTOR:
                self.vars[f"cond.{k}"].set(str(getattr(self.datos.conductor, k)))
        self._mostrar_advertencias(self.datos.errores, self.datos.advertencias)
        if self.datos.errores:
            self.nb_res.select(len(self.nb_res.tabs()) - 1)
            messagebox.showerror("Datos con errores",
                                 "El archivo tiene errores. Revise la pestaña Advertencias.")
            self._estado("Archivo con errores.")
        else:
            self._estado(f"{self.datos.n_apoyos} apoyos y {self.datos.n_vanos} vanos leídos. "
                         "Pulse Calcular.")

    def calcular(self):
        if self.datos is None:
            return messagebox.showwarning("Calcular", "Primero abra un archivo de datos.")
        try:
            p = self._leer_widgets()
            # releer por si cambió la altura de amarre por defecto
            self.datos = leer_datos(self.datos.archivo, p.criterios)
            self.res = calcular_plantillado(self.datos, p)
        except (ValueError, ErrorCalculo) as e:
            self._mostrar_advertencias([str(e)], self.datos.advertencias if self.datos else [])
            return messagebox.showerror("No se pudo calcular", str(e))
        except Exception:
            traceback.print_exc()
            return messagebox.showerror("Error inesperado", traceback.format_exc(limit=3))
        self.pagina = 0
        self._dibujar()
        self._llenar_tablas()
        self._mostrar_advertencias([], self.res.advertencias)
        self.btn_exportar.state(["!disabled"])
        r = self.res.resumen
        self._estado(f"Cálculo completo: {r['Número de vanos']} vanos, "
                     f"{r['Secciones de tendido']} secciones, conductor/fase "
                     f"{r['Longitud de conductor por fase (m)']} m, "
                     f"{r['Vanos que no cumplen distancia']} vanos sin distancia, "
                     f"{r['Apoyos con arrancamiento']} apoyos con arrancamiento.")
        self.nb_res.select(0)

    def exportar(self):
        if self.res is None:
            return
        carpeta = filedialog.askdirectory(title="Carpeta donde guardar los resultados",
                                          initialdir=str(Path(self.datos.archivo).parent))
        if not carpeta:
            return
        Path(carpeta).mkdir(parents=True, exist_ok=True)
        base = Path(carpeta) / Path(self.datos.archivo).stem
        hechos, fallos = [], []
        for nombre, fn, ext in (("Excel", exportar_excel, "_RESULTADOS.xlsx"),
                                ("PDF", exportar_pdf, "_PERFIL.pdf"),
                                ("DXF", exportar_dxf, "_PERFIL.dxf")):
            ruta = Path(str(base) + ext)
            try:
                fn(self.res, ruta)
                hechos.append(str(ruta))
            except PermissionError:
                fallos.append(f"{nombre}: el archivo está abierto en otro programa ({ruta.name}).")
            except Exception as e:
                fallos.append(f"{nombre}: {e}")
        msg = "Archivos generados:\n" + "\n".join(hechos)
        if fallos:
            msg += "\n\nNo generados:\n" + "\n".join(fallos)
            messagebox.showwarning("Exportar", msg)
        else:
            messagebox.showinfo("Exportar", msg)
            if sys.platform.startswith("win"):
                os.startfile(carpeta)  # abre la carpeta en el Explorador
        self._estado(f"Exportado a {carpeta}")

    # ============================================================== vistas
    def _dibujar(self):
        pags = paginas(self.res)
        self.pagina = max(0, min(self.pagina, len(pags) - 1))
        ini, fin = pags[self.pagina]
        self.fig.clear()
        self.ax = self.fig.add_subplot(111)
        dibujar_perfil(self.ax, self.res, ini, fin)
        self.fig.tight_layout()
        self.canvas.draw_idle()
        self.lbl_pagina.config(text=f"Página {self.pagina + 1} de {len(pags)}")

    def _ir_pagina(self, d):
        if self.res:
            self.pagina += d
            self._dibujar()

    def _llenar_tabla(self, tv: ttk.Treeview, df):
        tv.delete(*tv.get_children())
        cols = [str(c) for c in df.columns]
        tv["columns"] = cols
        for c in cols:
            tv.heading(c, text=c)
            tv.column(c, width=max(70, min(220, 8 * len(c))), anchor="center", stretch=False)
        for _, fila in df.iterrows():
            vals = ["" if (isinstance(v, float) and v != v) else v for v in fila.tolist()]
            alerta = ("NO" in vals) or (fila.get("Arrancamiento") == "SÍ")
            tv.insert("", "end", values=vals, tags=("alerta",) if alerta else ())

    def _llenar_tablas(self):
        import pandas as pd
        self._llenar_tabla(self.tablas["Resumen"],
                           pd.DataFrame(list(self.res.resumen.items()), columns=["Concepto", "Valor"]))
        self.tablas["Resumen"].column("Concepto", width=320, anchor="w")
        self.tablas["Resumen"].column("Valor", width=420, anchor="w")
        self._llenar_tabla(self.tablas["Secciones"], tabla_secciones(self.res))
        self._llenar_tabla(self.tablas["Vanos"], self.res.vanos)
        self._llenar_tabla(self.tablas["Apoyos"], self.res.apoyos)

    def _mostrar_advertencias(self, errores, advertencias):
        self.txt_adv.delete("1.0", "end")
        if errores:
            self.txt_adv.insert("end", "ERRORES\n", "t")
            for e in errores:
                self.txt_adv.insert("end", f"✖ {e}\n", "e")
            self.txt_adv.insert("end", "\n")
        self.txt_adv.insert("end", "ADVERTENCIAS\n", "t")
        for a in advertencias or ["Sin advertencias."]:
            self.txt_adv.insert("end", f"• {a}\n")
        self.txt_adv.tag_configure("t", font=("Segoe UI", 11, "bold"))
        self.txt_adv.tag_configure("e", foreground="#b00020")

    def _estado(self, txt):
        self.lbl_estado.config(text=txt)

    def _salir(self):
        self.quit()
        self.destroy()


def main():
    App().mainloop()


if __name__ == "__main__":
    main()

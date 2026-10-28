"""Prepara la versión web (GitHub Pages) en una carpeta aparte:

    python construir_web.py
    python publicar_github/preparar_pages.py  <carpeta destino>

Copia web/ y, si hay esbuild, junta todo el JavaScript en un solo archivo (js/app.bundle.js) traducido para
navegadores de celulares y tabletas algo antiguos (Chrome 80, Safari 14.1): una sola descarga en vez de trece.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
WEB = RAIZ / "web"


def main(destino: Path):
    if destino.exists():
        for p in destino.iterdir():
            if p.name not in (".git", ".nojekyll"):
                shutil.rmtree(p) if p.is_dir() else p.unlink()
    destino.mkdir(parents=True, exist_ok=True)
    shutil.copytree(WEB, destino, dirs_exist_ok=True, ignore=shutil.ignore_patterns("pdf"))
    (destino / ".nojekyll").touch()
    esb = shutil.which("esbuild")
    if not esb:
        print("sin esbuild: se publican los módulos sin juntar")
        return
    objetivo = "chrome80,safari14.1"
    subprocess.run([esb, str(WEB / "js" / "app.js"), "--bundle", "--format=esm", f"--target={objetivo}", "--minify",
                    f"--outfile={destino / 'js' / 'app.bundle.js'}"], check=True)
    subprocess.run([esb, str(WEB / "js" / "pyworker.js"), f"--target={objetivo}", "--minify",
                    f"--outfile={destino / 'js' / 'pyworker.js'}"], check=True)
    v = re.search(r"app\.js\?v=(\d+)", (WEB / "index.html").read_text(encoding="utf-8")).group(1)
    idx = destino / "index.html"
    idx.write_text(re.sub(r'js/app\.js\?v=\d+', f"js/app.bundle.js?v={v}", idx.read_text(encoding="utf-8")), encoding="utf-8")
    sw = destino / "service-worker.js"
    s = sw.read_text(encoding="utf-8")
    s = re.sub(r"'\./js/app\.js\?v=\d+'", f"'./js/app.bundle.js?v={v}'", s)
    s = re.sub(r", '\./js/(motor|perfil|geo-ui|estructuras-eh|visor3d|bloques3d|earth3d|cad|clima|mapa)\.js[^']*'", "", s)
    s = s.replace("'./js/elevacion.js', ", "")
    sw.write_text(s, encoding="utf-8")
    print("web lista en", destino, "con js/app.bundle.js")


if __name__ == "__main__":
    main(Path(sys.argv[1]))

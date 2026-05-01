"""
Downloads SSA baby name files (yob1880.txt ... yob2024.txt) into data/raw/ssa/.
Source: https://www.ssa.gov/oact/babynames/names.zip
Each file format: name,gender,count  (no header, gender is M or F)
"""
import os
import urllib.request
import zipfile
import io

SCRIPTS_DIR = os.path.dirname(__file__)
SSA_DIR = os.path.join(SCRIPTS_DIR, '..', 'raw', 'ssa')
SSA_URL = 'https://www.ssa.gov/oact/babynames/names.zip'


def download():
    os.makedirs(SSA_DIR, exist_ok=True)

    print(f"Downloading {SSA_URL} ...")
    with urllib.request.urlopen(SSA_URL) as response:
        data = response.read()
    print(f"Downloaded {len(data) / 1_000_000:.1f} MB")

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        yob_files = [n for n in zf.namelist() if n.startswith('yob') and n.endswith('.txt')]
        print(f"Extracting {len(yob_files)} yearly files...")
        for name in yob_files:
            zf.extract(name, SSA_DIR)

    years = sorted(
        int(f[3:7]) for f in os.listdir(SSA_DIR)
        if f.startswith('yob') and f.endswith('.txt')
    )
    print(f"Done. Years: {years[0]}–{years[-1]}  ({len(years)} files)")
    print(f"Saved to {os.path.abspath(SSA_DIR)}")


if __name__ == '__main__':
    download()

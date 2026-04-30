import os
import requests

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', 'raw')
DXDC_URL = "https://raw.githubusercontent.com/dxdc/babynames/master/data/all-names.csv"


def download():
    os.makedirs(RAW_DIR, exist_ok=True)
    output_path = os.path.join(RAW_DIR, 'all-names.csv')

    print("Downloading dxdc/babynames dataset...")
    response = requests.get(DXDC_URL, timeout=30)
    response.raise_for_status()

    with open(output_path, 'wb') as f:
        f.write(response.content)

    line_count = response.text.count('\n')
    print(f"Saved {line_count - 1} names to {output_path}")


if __name__ == '__main__':
    download()

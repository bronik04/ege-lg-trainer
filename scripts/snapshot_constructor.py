"""Снимок заданий 15–27 из банка «ЕГЭ Конструктора» в sources/.

Копирует блоки grammar-15 … grammar-27 байт в байт и пишет sources/manifest.json
с контрольными суммами. Сам банк Конструктора не изменяется. Запускается вручную,
когда в Конструкторе появились новые задания; дальше конвейер читает только снимок.

    python3 scripts/snapshot_constructor.py [путь к bank/blocks]
"""

import datetime
import hashlib
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import MANIFEST, SNAPSHOT, TASK_NUMBERS, write_json  # noqa: E402

DEFAULT_BANK = Path.home() / "Library/Application Support/ege-chinese-constructor/bank/blocks"
GRAMMAR_TYPES = {f"grammar-{n}" for n in TASK_NUMBERS}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main(argv):
    bank = Path(argv[1]) if len(argv) > 1 else DEFAULT_BANK
    if not bank.is_dir():
        sys.exit(f"Нет каталога банка: {bank}")

    picked = []
    for path in sorted(bank.glob("*.json")):
        block = json.loads(path.read_text(encoding="utf-8"))
        if block.get("type") in GRAMMAR_TYPES:
            picked.append((path, block["type"]))

    if SNAPSHOT.exists():
        shutil.rmtree(SNAPSHOT)
    SNAPSHOT.mkdir(parents=True)
    files = {}
    for path, _ in picked:
        target = SNAPSHOT / path.name
        shutil.copyfile(path, target)
        files[path.name] = sha256(target)

    counts = Counter(kind for _, kind in picked)
    write_json(MANIFEST, {
        "source": "Банк заданий приложения «ЕГЭ Конструктор» (ege-chinese-constructor), тег «Банк ФИПИ»",
        "sourcePath": str(bank).replace(str(Path.home()), "~"),
        "snapshotDate": datetime.date.today().isoformat(),
        "blockTypes": {kind: counts[kind] for kind in sorted(counts, key=lambda k: int(k.split("-")[1]))},
        "files": files,
    })
    print(f"Снимок: {len(picked)} блоков → {SNAPSHOT}")


if __name__ == "__main__":
    main(sys.argv)

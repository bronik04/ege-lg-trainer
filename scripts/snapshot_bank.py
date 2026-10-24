"""Снимок выгрузки единого банка заданий в sources/bank/.

Выгрузку делает банк (`ege-task-bank`: `npm run bank -- export-sites lg <файл>`): задания 15–27,
которые банк разрешает сайтам, с ID заданий тренажёра. Скрипт кладёт её в репозиторий байт в байт
и пишет manifest.json с контрольной суммой; дальше конвейер читает только снимок.

    python3 scripts/snapshot_bank.py <выгрузка.json>
"""

import hashlib
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import BANK_SCHEMA, BANK_SOURCE, write_json  # noqa: E402


def snapshot(export_path, target=BANK_SOURCE):
    export_path, target = Path(export_path), Path(target)
    data = json.loads(export_path.read_text(encoding="utf-8"))
    if data.get("schemaVersion") != BANK_SCHEMA:
        raise SystemExit(f"выгрузка банка: schemaVersion {data.get('schemaVersion')!r}, ожидается {BANK_SCHEMA}")
    target.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(export_path, target / "export.json")
    counts = Counter(str(block["taskNumber"]) for block in data["blocks"])
    write_json(target / "manifest.json", {
        "source": "Единый банк заданий ЕГЭ (ege-task-bank), export-sites lg",
        "generatedAt": data["generatedAt"],
        "sha256": hashlib.sha256((target / "export.json").read_bytes()).hexdigest(),
        "taskCounts": dict(sorted(counts.items())),
        "withdrawn": len(data.get("withdrawn", [])),
    })
    return data


def main(argv):
    if len(argv) != 2:
        sys.exit("python3 scripts/snapshot_bank.py <выгрузка.json>")
    data = snapshot(argv[1])
    print(f"Снимок банка от {data['generatedAt']}: {len(data['blocks'])} заданий → {BANK_SOURCE}")


if __name__ == "__main__":
    main(sys.argv)

"""Снимок файла автора с заданиями HSK 4 (№26) в sources/hsk4/.

Копирует файл байт в байт под именем hsk4-task26.md и пишет sources/hsk4/manifest.json с
контрольной суммой. Сам файл автора не изменяется. Запускается вручную, когда автор обновил
файл; дальше конвейер читает только снимок (import_hsk.py).

    python3 scripts/snapshot_hsk.py [путь к файлу]
"""

import datetime
import hashlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HSK_MANIFEST, HSK_SOURCE, write_json  # noqa: E402

DEFAULT_FILE = (Path.home() / "Yandex.Disk.localized/Китайский язык/03-Экзамены/02-ЕГЭ/01-Банк_заданий"
                / "1_Импорт_в_программу/hsk4_задание26_порядок_фрагментов_2026-09.md")
# Имя латиницей: кириллица в имени файла по-разному нормализуется в macOS и Linux (CI).
SNAPSHOT_NAME = "hsk4-task26.md"


def main(argv):
    source = Path(argv[1]) if len(argv) > 1 else DEFAULT_FILE
    if not source.is_file():
        sys.exit(f"Нет файла заданий HSK: {source}")
    HSK_SOURCE.mkdir(parents=True, exist_ok=True)
    for old in HSK_SOURCE.glob("*.md"):
        if old.name != "README.md":
            old.unlink()
    target = HSK_SOURCE / SNAPSHOT_NAME
    shutil.copyfile(source, target)
    write_json(HSK_MANIFEST, {
        "source": "Файл автора: задания №26 из материалов HSK 4 (блоки «ЕГЭ Конструктора»)",
        "sourcePath": str(source).replace(str(Path.home()), "~"),
        "snapshotDate": datetime.date.today().isoformat(),
        "files": {target.name: hashlib.sha256(target.read_bytes()).hexdigest()},
    })
    print(f"Снимок HSK: {source.name} → {target}")


if __name__ == "__main__":
    main(sys.argv)

"""Everything the server prints also goes to logs/server.log, with the time of
each line, so a failed analysis can be looked into after the window is closed."""
import sys
import threading
from datetime import datetime
from pathlib import Path

LOG_FILE = Path(__file__).parent / "logs" / "server.log"


class _Tee:
    """A stream that writes to the console as before and to the log file."""

    def __init__(self, stream, file, lock):
        self.stream, self.file, self.lock = stream, file, lock
        self.line_start = True

    def write(self, text: str) -> int:
        self.stream.write(text)
        with self.lock:
            for part in text.splitlines(keepends=True):
                if self.line_start:
                    self.file.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S  "))
                self.file.write(part)
                self.line_start = part.endswith("\n")
            self.file.flush()
        return len(text)

    def flush(self) -> None:
        self.stream.flush()

    def __getattr__(self, name):
        return getattr(self.stream, name)


def start() -> None:
    if isinstance(sys.stdout, _Tee):
        return
    LOG_FILE.parent.mkdir(exist_ok=True)
    file = open(LOG_FILE, "a", encoding="utf-8")
    lock = threading.Lock()
    sys.stdout = _Tee(sys.stdout, file, lock)
    sys.stderr = _Tee(sys.stderr, file, lock)

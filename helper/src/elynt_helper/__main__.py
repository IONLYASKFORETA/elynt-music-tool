import sys

from .server import serve

if __name__ == "__main__":
    sys.exit(serve(sys.stdin, sys.stdout))

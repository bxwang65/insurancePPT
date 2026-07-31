#!/usr/bin/env python3
"""insdeck CLI - 官方计划书 → 客户正式版"""
import sys
from insdeck.cli import main
if __name__ == '__main__':
    sys.exit(main() or 0)

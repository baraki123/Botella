import os

# Ensure tests use the dev secret without warnings.
os.environ.setdefault("BOTELLA_ENV", "test")

# matrix include replaced the whole matrix

## Briefing

You wanted "default python 3.12 on ubuntu, plus one extra cell for 3.13". You
wrote `matrix.include` without `matrix.python` and got **only** the include
rows — or you used `exclude` that removed every cell. `include` **adds** (or
overrides matching combinations); it does not define the cartesian product by
itself unless it is the only key. Empty product + include is a common
"matrix has 1 job, I expected 6".

## Your Task

- Build a matrix that accidentally has one cell.
- Restore cartesian `os × python` plus `include` for an extra experimental
  cell.
- Use `exclude` to drop one pair without emptying the matrix.

## Starter Files

### file: .github/workflows/test.yml

```yaml
name: test
on: push
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            python: "3.12"
          # forgot the base arrays
    steps:
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
      - run: python -m pytest
```

## Expected Failure

```text
Only 1 job: ubuntu + 3.12
macos and 3.11 never run
```

Or with `exclude` of `python: 3.12` while that was the only version — **zero**
jobs, workflow success with nothing tested (`if` no jobs).

## Expected Outcome

Four base cells plus one include:

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest]
    python: ["3.11", "3.12"]
    include:
      - os: ubuntu-latest
        python: "3.13"
        experimental: true
    exclude:
      - os: macos-latest
        python: "3.11"
```

Job count is 4 (2×2) + 1 include − 1 exclude = 4.

## Hints

### Hint 1 — include adds rows

Each `include` item is a full combination. If it matches an existing
combination's keys, it **adds fields** to that cell (e.g. `experimental`). If
it does not match, it **adds a cell**.

### Hint 2 — empty matrix is a silent pass

`jobs.test` with 0 combinations: workflow is success. Add
`if: ${{ always() }}` guards or assert job count in a required wrapper. Prefer
explicit arrays so an exclude cannot zero everything unnoticed.

## Solution

```yaml
matrix:
  os: [ubuntu-latest, macos-latest]
  python: ["3.11", "3.12"]
  include:
    - os: ubuntu-latest
      python: "3.13"
```

- **`max-parallel`** does not change how many cells exist.
- **`matrix: ${{ fromJSON(inputs.matrix) }}`** from a previous job is
  powerful and easy to emit `[]`.
- **Variable interpolation in matrix** (`python: ${{ env.X }}`) is not
  allowed in all places — generate JSON in a setup job instead.
- **Name cells** with `name: test ${{ matrix.os }} ${{ matrix.python }}` for
  required checks.

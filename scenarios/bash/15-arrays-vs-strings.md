# "${arr[1]}" is empty and arr=foo still looks like an array

## Briefing

You wrote `files=*.txt` (no parens) and `${files[1]}` is empty;
`${#files[@]}` is 1 even for many files — it is a string. Or
`arr=(one two)` then `echo $arr` prints only `one`. Or you copied
`arr=$arr $new` and broke the array.

Bash arrays need `()`, `"${arr[@]}"`, and `+=()`. String operations on arrays
use only element 0.

## Your Task

- Assign a glob to a string vs an array and compare `${#...}`.
- Print all elements correctly.
- Append without flattening.

## Starter Files

### file: arr.sh

```bash
#!/usr/bin/env bash
set -euo pipefail
touch a.txt b.txt
files=*.txt
echo "string len chars? ${#files}"
echo "string as array len ${#files[@]}"
echo "index1 [${files[1]}]"
echo "unquoted \$files: $files"

files=(*.txt)
echo "array len ${#files[@]}"
echo "echo \$files: $files"
echo "echo all: ${files[@]}"
```

## Expected Failure

```bash
bash arr.sh
# string len chars? 11          # length of the string "a.txt b.txt" or "a.txt"
# string as array len 1
# index1 []
# unquoted $files: a.txt b.txt
# array len 2
# echo $files: a.txt            <- only [0]
# echo all: a.txt b.txt
```

`${files[1]}` on a string is empty. `echo $files` on an array is `echo ${files[0]}`.

## Expected Outcome

You always use `"${files[@]}"` for elements and `files+=("new")` to append.

```bash
files=(*.txt)
printf '<%s>\n' "${files[@]}"
# <a.txt>
# <b.txt>
files+=("c.txt")
echo "${#files[@]}"
# 3
```

## Hints

### Hint 1 — Parentheses make the array

`arr=(*.txt)` with `nullglob`. `declare -a arr`. `arr=*.txt` is a string (glob
may or may not expand depending on quoting). `declare -p files` shows `a` vs
plain string.

### Hint 2 — @ vs *

`"${arr[@]}"` → each element, like `"$@"` . `"${arr[*]}"` → one word joined by
IFS. Unquoted `${arr[@]}` re-splits elements. Always quote `@`.

## Solution

Use real arrays end to end.

```bash
shopt -s nullglob
files=(*.txt)
printf '<%s>\n' "${files[@]}"
files+=("more.txt")
```

- **`$arr` is `[0]`.** Muscle memory from other languages lies.
- **`arr+=(x)` vs `arr="$arr x"`:** the second destroys the array (turns it into
  a string).
- **Associative arrays** (`declare -A`) need bash 4 and `arr[key]` not
  `arr[0]` as a list. Mixing them is a type error.
- **`set -u` + `${arr[1]}`** fails if the index is unset — `"${arr[1]:-}"` or
  test length first.

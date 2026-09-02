# The variable that is empty in the shell step

## Briefing

A pipeline sets a variable and uses it in a `sh` step. The shell sees an empty value.
Someone tries string interpolation and now the value appears in the build log in clear
text, including a token.

The confusion is between Groovy interpolation and shell expansion — two different
languages processing the same line.

## Your Task

- Run the pipeline and confirm the variable is empty in the shell.
- Fix it so the shell sees the value.
- Fix the credential handling so the token is expanded by the shell, not baked into the
  logged script.

## Starter Files

### file: Jenkinsfile

```groovy
pipeline {
    agent any

    environment {
        REGION = 'eu-west-1'
        API_TOKEN = credentials('api-token')
    }

    stages {
        stage('Deploy') {
            steps {
                // single quotes: Groovy does NOT interpolate, but the shell has no $REGION either
                sh 'echo "deploying to $region"'
                // double quotes: Groovy DOES interpolate - the token is baked into the script text
                sh "curl -H 'Authorization: Bearer ${API_TOKEN}' https://api.example.com/deploy"
            }
        }
    }
}
```

## Expected Failure

```
+ echo "deploying to "
deploying to
```

`$region` is empty — the environment variable is `REGION`, not `region`, and the shell
had no such variable. Meanwhile the second step leaks:

```
+ curl -H 'Authorization: Bearer glpat-9fJ2kd...' https://api.example.com/deploy
```

Because double quotes let **Groovy** substitute `${API_TOKEN}` into the script string
before the shell ever runs, the secret is written verbatim into the console log.

## Expected Outcome

The region reaches the shell, and the token does not reach the log.

```
+ echo "deploying to eu-west-1"
deploying to eu-west-1
```

The token is masked or absent from the log:

```
+ curl -H 'Authorization: Bearer ****' ...
# or the variable name appears, never the value
```

The deploy still authenticates correctly (the shell expands the real value at runtime).

## Hints

### Hint 1 — Two languages, two expansion rules

In a `sh` step:

- **Double quotes** → Groovy interpolates `${...}` first, then hands the result to the
  shell. The final value is written into the logged script.
- **Single quotes** → Groovy leaves the string alone; the shell expands `$VAR` at
  runtime from its environment.

Environment variables declared in `environment {}` are exported to the shell, so the
shell can expand them — if you use single quotes and the correct name.

### Hint 2 — Single quotes for anything sensitive, correct case for names

```groovy
sh 'echo "deploying to $REGION"'
sh 'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com/deploy'
```

`$REGION`, not `$region` — shell variable names are case-sensitive and match the
declaration. Single quotes keep the secret out of the logged script and let Jenkins'
masking work.

## Solution

Wrong variable case in one step, and Groovy interpolation of a secret in the other.

```groovy
pipeline {
    agent any

    environment {
        REGION = 'eu-west-1'
        API_TOKEN = credentials('api-token')
    }

    stages {
        stage('Deploy') {
            steps {
                // single quotes: the shell expands $REGION from the exported environment
                sh 'echo "deploying to $REGION"'
                sh 'curl -H "Authorization: Bearer $API_TOKEN" https://api.example.com/deploy'
            }
        }
    }
}
```

- **Prefer single quotes for `sh` steps.** Let the shell do the expansion. Reach for
  double quotes only when you deliberately want a Groovy value inlined, and never for a
  secret.
- **Double-quoting a credential defeats masking.** Masking is a string replacement on the
  output; if Groovy has already inlined the value into the script text, the exact bytes
  still appear. Single quotes keep the value in an environment variable the shell reads.
- **`credentials('id')` in `environment` also creates `_USR` and `_PSW` companions** for
  username/password credentials — useful, and another thing to keep out of double-quoted
  strings.
- **Variable names are case-sensitive in the shell.** `REGION` and `region` are different
  variables; the empty one just expands to nothing with no error.

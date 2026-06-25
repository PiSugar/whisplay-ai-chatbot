# Whisplay Skills

Place project-local skills here so the hardness tools can discover them on the Raspberry Pi.
Local skill directories are intentionally ignored by git.

Each skill should live in its own directory with a `SKILL.md` file:

```text
skills/
  example-skill/
    SKILL.md
```

`SKILL.md` may include frontmatter:

```markdown
---
name: example-skill
description: Short description shown by listSkills.
---
```

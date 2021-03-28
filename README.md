# vscode-fzf README

Early attempt at emulating a rg fuzzy finder such as fzf.vim's :Rg or
telescope.nvim's live_grep.

Exposes the command `vscode-fzf.rg`

# TODO

-   Don't jump immediately as soon as a result is available as that is
    just annoying. When is the correct time to do the first jump?

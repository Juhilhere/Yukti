Per-area translation dictionaries. Each file default-exports `{ en, hi, kn }` (Record<string, string>).
Keys are namespaced by area (`chat.*`, `admin.users.*`, ...). Placeholders use `{name}` and are filled by `t(key, { name })`.
Technical and product terms stay in English where plant staff use them (SOP, P&ID, LOTO, MCC, HOD, Yukti, Laya, tag numbers).

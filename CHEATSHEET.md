# VLAN Exam Cheat Sheet

## Order (never jump around)
1. **Switch1 → Switch2 → Switch3** CLI
2. **Cables** (Ctrl+click Copper Straight-Through)
3. **IPs** (if not preset)
4. **Fast Forward Time**
5. **Test** (Simple PDU + browser)

---

## Every switch (same block)
```
en
conf t
no ip domain-l
vl 100
na BLUE
vl 200
na GREEN
in ra f0/23-24
sw mo tr
```
Add one `vl` + `na` pair per color.

## Each color on that switch (repeat)
```
in ra <ports>
sw mo acc
sw acc vl <ID>
```

## Server (Switch3, any free port, not 23/24)
```
in f0/1
sw mo acc
sw acc vl <server color ID>
```

## Check
```
do sh vl br      ! ports under the right VLAN
do sh int tr     ! 23/24 say "trunking"
```

---

## Writing ports
| Sheet says | Type |
|---|---|
| Fa0/5 | `in f0/5` |
| Fa0/13, Fa0/14, Fa0/15 | `in ra f0/13-15` |
| Fa0/22, Fa0/6, Fa0/17 | `in ra f0/22,f0/6,f0/17` |
| Fa0/1, Fa0/2, Fa0/9 | `in ra f0/1-2,f0/9` |

## Short forms
| Short | Full |
|---|---|
| `en` | enable |
| `conf t` | configure terminal |
| `vl 100` | vlan 100 |
| `na BLUE` | name BLUE |
| `in ra` | interface range |
| `sw mo acc` | switchport mode access |
| `sw acc vl 100` | switchport access vlan 100 |
| `sw mo tr` | switchport mode trunk |
| `do sh vl br` | show vlan brief (from config mode) |
| `wr` | write memory (at `Switch#`) |

---

## Prompts: where am I?
| Prompt | Type next |
|---|---|
| `Switch>` | `en` |
| `Switch#` | `conf t` (or `sh ...`) |
| `Switch(config)#` | `vl`, `in`, `do sh ...` |
| `Switch(config-vlan)#` | `na BLUE` |
| `Switch(config-if-range)#` | `sw ...` |

## Errors
| Message | Meaning / fix |
|---|---|
| `% Invalid input detected at '^'` | Typo at the `^`, or wrong mode (`sh` in config → use `do sh`) |
| `% Incomplete command.` | Missing the last word (e.g. `vl` without a number) |
| `% Ambiguous command` | Too short (`c`, `v`, `en` in config). Add a letter. |
| `Translating "xyz"...` | Typo at `>`/`#`. **Ctrl+Shift+6**, then `no ip domain-l` |
| `% Access VLAN does not exist. Creating vlan X` | You skipped `vl X` / `na`. Go name it. |

## Fixes
- Wrong VLAN on a port → just retype `sw acc vl <right ID>`
- Wrong name → `vl 100` then `na BLUE`
- Extra VLAN → `no vl 300`

---

## Keys
| Key | Does |
|---|---|
| Tab | Finish word |
| ↑ / ↓ | Previous / next command (reuse `sw mo acc`) |
| ? | What can I type here? |
| Ctrl+Z | `end` |
| Ctrl+Shift+6 | Break typo freeze |
| Ctrl+A / Ctrl+E | Start / end of line |
| Ctrl+W | Delete last word |
| Ctrl+F6 | Leave the CLI box |
| Ctrl+click cable | Cable stays selected |
| Esc | Cancel, back to Select |

Packet Tracer reopens a device on the **last tab used**, so click CLI or Desktop once and it stays.

---

## IPs
- Same network for everyone: `192.168.100.x`
- Mask `255.255.255.0` (click the mask box and it fills in)
- PCs: `.10`–`.100`, all different. Server: the IP on the sheet (e.g. `.2`)
- No gateway

## Expected test results
- Same color → **reply**
- Different color → **Request timed out** (correct!)
- Server from its own color → browser opens
- First ping may time out once (ARP), so ping again

## 5 rules
1. **Every switch gets every VLAN**, including the middle one.
2. **Trunk f0/23-24 on every switch.**
3. **One `in ra` block per color.**
4. **The server = just another access port.**
5. **Type everything, check once at the end.**

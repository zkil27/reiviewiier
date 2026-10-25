# Practice Midterm: Multi-Color VLANs + Enrollment Servers

Same pattern as `VLAN-DTP-WITH-SERVER-ASS-2-MIDTERM.pkt`, harder: 4 colors, 2 enrollment servers, PCs on two switches.
Start a stopwatch. Your goal is under 8 minutes on the first run and under 5 after a few runs.

---

## 1. The Exam

### Topology (build this in Packet Tracer)
```
 PC0..PC7                 PC8  PC9                 BLUE ENROLL   GREEN ENROLL
     \                      |   |                        |             |
   [Switch1] Fa0/24 ---- Fa0/23 [Switch2] Fa0/24 ---- Fa0/23 [Switch3]
   (2960-24TT)                 (2960-24TT)                  (2960-24TT)
```
- 10 × PC-PT, 2 × Server-PT, 3 × 2960-24TT switches.
- Color the PCs with the drawing tool if you want it to look like the real exam. It's optional and costs time.

### Step 1: Create VLANs (on ALL switches)
| VLAN | Name   |
|------|--------|
| 100  | BLUE   |
| 200  | GREEN  |
| 300  | RED    |
| 400  | YELLOW |

### Step 2: Assign ports
**Switch1**
- BLUE = Fa0/13, Fa0/14
- GREEN = Fa0/2, Fa0/6
- RED = Fa0/8, Fa0/9
- YELLOW = Fa0/18, Fa0/20

**Switch2**
- RED = Fa0/3
- YELLOW = Fa0/4

**Switch3**
- BLUE Enrollment System: any free port (answer key uses Fa0/1)
- GREEN Enrollment System: any free port (answer key uses Fa0/2)

### Step 3: Trunks
On Switch1, Switch2 and Switch3, configure **Fa0/23 and Fa0/24** as trunk ports.

### Step 4: Connect devices
| Device | Color  | Switch  | Port   | IP              |
|--------|--------|---------|--------|-----------------|
| PC0    | BLUE   | Switch1 | Fa0/13 | 192.168.100.10  |
| PC1    | BLUE   | Switch1 | Fa0/14 | 192.168.100.11  |
| PC2    | GREEN  | Switch1 | Fa0/2  | 192.168.100.12  |
| PC3    | GREEN  | Switch1 | Fa0/6  | 192.168.100.13  |
| PC4    | RED    | Switch1 | Fa0/8  | 192.168.100.14  |
| PC5    | RED    | Switch1 | Fa0/9  | 192.168.100.15  |
| PC6    | YELLOW | Switch1 | Fa0/18 | 192.168.100.16  |
| PC7    | YELLOW | Switch1 | Fa0/20 | 192.168.100.17  |
| PC8    | RED    | Switch2 | Fa0/3  | 192.168.100.18  |
| PC9    | YELLOW | Switch2 | Fa0/4  | 192.168.100.19  |
| BLUE ENROLLMENT  | BLUE  | Switch3 | Fa0/1 | 192.168.100.2 |
| GREEN ENROLLMENT | GREEN | Switch3 | Fa0/2 | 192.168.100.3 |

### Step 5: IP addressing
- Network 192.168.100.0/24, mask 255.255.255.0, **no default gateway**
- PC range .10 to .100 (pattern: **PCn = .1n**, so you never have to think)

### Step 6: Test and expected results
| Test | Expected |
|------|----------|
| PC0 → PC1 (BLUE ↔ BLUE) | ✅ Reply |
| PC2 → PC3 (GREEN ↔ GREEN) | ✅ Reply |
| PC4 → PC8 (RED on S1 ↔ RED on S2, crosses trunk) | ✅ Reply |
| PC6 → PC9 (YELLOW S1 ↔ YELLOW S2) | ✅ Reply |
| PC0 → 192.168.100.2 + Web Browser `http://192.168.100.2` | ✅ Page loads |
| PC2 → 192.168.100.3 + Web Browser `http://192.168.100.3` | ✅ Page loads |
| PC0 → PC2 (BLUE ↔ GREEN) | ❌ Request timed out (**correct!**) |
| PC2 → 192.168.100.2 (GREEN → BLUE server) | ❌ Timed out (**correct!**) |
| PC4 → 192.168.100.2 (RED → BLUE server) | ❌ Timed out (**correct!**) |

> Different colors CAN'T talk even though they're in the same subnet. VLANs split the switch into separate
> broadcast domains, so ARP never reaches the other color. No router means no inter-VLAN routing. That's the point.

---

## 2. Answer Key (paste-ready)

### Block A: same on ALL 3 switches (type once, copy, paste into the others)
```
enable
configure terminal
no ip domain-lookup
vlan 100
 name BLUE
vlan 200
 name GREEN
vlan 300
 name RED
vlan 400
 name YELLOW
exit
interface range fa0/23-24
 switchport mode trunk
exit
```

### Block B: Switch1 only
```
interface range fa0/13-14
 switchport mode access
 switchport access vlan 100
interface range fa0/2, fa0/6
 switchport mode access
 switchport access vlan 200
interface range fa0/8-9
 switchport mode access
 switchport access vlan 300
interface range fa0/18, fa0/20
 switchport mode access
 switchport access vlan 400
end
write memory
```

### Block B: Switch2 only
```
interface fa0/3
 switchport mode access
 switchport access vlan 300
interface fa0/4
 switchport mode access
 switchport access vlan 400
end
write memory
```

### Block B: Switch3 only
```
interface fa0/1
 switchport mode access
 switchport access vlan 100
interface fa0/2
 switchport mode access
 switchport access vlan 200
end
write memory
```

### Verify (run on each switch)
```
show vlan brief          ! every port listed under the right VLAN, 23/24 NOT listed (trunks hide from this)
show interfaces trunk    ! Fa0/23 and Fa0/24 show "on" / "trunking"
```

> If Packet Tracer rejects `fa0/2, fa0/6`, add spaces around the comma: `fa0/2 , fa0/6`.

---

## 3. Speed Tips (do it in this order)

**Order: Cables → Switch CLI → IPs → Test.** Never bounce back and forth.

1. **Check the existing switch links first (10 sec).** Options → Preferences → tick **"Always Show Port Labels in Logical Workspace"**.
   If the switch-to-switch cables aren't on Fa0/23 or Fa0/24, delete and redo them now, not after you've configured everything.
2. **Cable every PC in one go.** Hold **Ctrl** while clicking **Copper Straight-Through** so the cable stays selected,
   then click PC → FastEthernet0 → switch → port, over and over. **Never use the Automatic (lightning) cable**, because it picks random ports.
3. **Type Block A once on Switch1, then copy and paste it.** Select the text in the CLI window, Ctrl+C, then paste into Switch2 and Switch3's CLI.
   If Notepad is allowed in the exam, write Block A there before you even open Packet Tracer.
4. **Use short forms** (all valid IOS):

   | Full | Short |
   |------|-------|
   | `enable` / `configure terminal` | `en` / `conf t` |
   | `interface range fa0/13-14` | `int ra f0/13-14` |
   | `switchport mode access` | `sw mo acc` |
   | `switchport access vlan 100` | `sw acc vl 100` |
   | `switchport mode trunk` | `sw mo tr` |
   | `show vlan brief` (from config mode) | `do sh vl br` |
   | `write memory` | `wr` |

5. **Skip what isn't needed:** switch ports are already up, so no `no shutdown`. You don't need `exit` between `interface` commands.
   `vlan 200` works straight from inside `vlan 100` mode.
6. **`no ip domain-lookup` first.** Otherwise a typo like `shwo` freezes the CLI for ~30 sec while it "translates". If it happens: **Ctrl+Shift+6**.
7. **The DTP trap (that's why the file says "DTP"):** 2960 ports default to `dynamic auto`, and **auto + auto = NO trunk**.
   Always set `switchport mode trunk` on **both** ends of every switch link.
8. **IPs fast:** Desktop → IP Configuration → type the IP → **click the Subnet Mask box and it fills 255.255.255.0** by itself. Close, next PC.
   Hover over a PC to see its IP and double-check without opening it.
9. **Orange link lights = STP waiting (~30 sec).** Click **Fast Forward Time** (bottom-left, Realtime mode) instead of waiting.
10. **Test with Add Simple PDU** (closed envelope icon on the right toolbar): click PC0, then PC1, and the result shows in the bottom panel.
    Much faster than typing pings. **The first ping often times out (ARP), so send it twice before you panic.**
11. **Browser test last:** Server-PT has HTTP on by default. PC → Desktop → Web Browser → `192.168.100.2` → Go.
12. **Open several CLI windows at once.** You can have Switch1/2/3 windows open side by side and paste into each.

---

## 4. Mistakes That Cost People the Top-5 Spot

- [ ] **VLANs not created on Switch2.** Traffic dies in the middle switch even though S2 has no PCs (in the original exam). **Always paste Block A on every switch.**
- [ ] Server port left in VLAN 1 (forgot `sw acc vl 100` on Switch3)
- [ ] Trunk only set on one end, or on the wrong port
- [ ] Typo in VLAN name (`BLEU`): names may be graded, so use CAPS exactly like the exam sheet
- [ ] Duplicate IP (two PCs both .10)
- [ ] PC cabled to the wrong port. Hover over the link and compare it to the exam sheet before the CLI step.
- [ ] Adding a router or default gateway: **not needed**, and it can break the isolation the exam wants
- [ ] Forgetting `wr`: if the exam checks saved config, save on every switch

---

## 5. Bonus Run: 6 Colors (redo from scratch, time yourself)

| VLAN | Name   | Switch1 ports    | Other |
|------|--------|------------------|-------|
| 100  | BLUE   | Fa0/1, Fa0/12    | BLUE ENROLLMENT 192.168.100.2 on Switch3 |
| 200  | GREEN  | Fa0/3, Fa0/15    | GREEN ENROLLMENT 192.168.100.3 on Switch3 |
| 300  | RED    | Fa0/5, Fa0/19    | |
| 400  | YELLOW | Fa0/7, Fa0/21    | |
| 500  | ORANGE | Fa0/10, Fa0/16   | 1 PC on Switch2 Fa0/5 |
| 600  | PURPLE | Fa0/11, Fa0/22   | PURPLE ENROLLMENT 192.168.100.4 on Switch3 |

Trunks: still Fa0/23 and Fa0/24 on all switches. PCs: .10 and up.

**Self-check:** each color pings only itself, each server opens only from its own color, and ORANGE on Switch2 reaches ORANGE on Switch1.

> Drill idea: have a classmate scribble random ports and colors on paper and you race. The pattern never changes, only the numbers.

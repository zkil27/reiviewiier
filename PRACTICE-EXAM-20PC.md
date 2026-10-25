# Practice Exam: 5 Colors, 20 PCs

## Build it (once, then save as your practice .pkt)

**Devices:** 3 × 2960-24TT switches, 20 × PC-PT, 2 × Server-PT

**Quick building:**
- **Ctrl+click** the PC icon, then click the workspace 20 times. It stays selected. Press Esc when done.
- Cable the switches with **Copper Cross-Over**:
  - Switch1 Fa0/24 ↔ Switch2 Fa0/23
  - Switch2 Fa0/24 ↔ Switch3 Fa0/23
- **Leave the PCs uncabled.** Connecting them is part of the exam.
- Save it as `PRACTICE-20PC-BLANK.pkt`. Before each practice run, open the blank file again.

---

## The exam (start your timer)

### Step 1: Create VLANs on all switches
| VLAN | Name   |
|------|--------|
| 100  | BLUE   |
| 200  | GREEN  |
| 300  | RED    |
| 400  | YELLOW |
| 500  | ORANGE |

### Step 2: Assign ports

**Switch1 (12 PCs)**
- BLUE = Fa0/13, Fa0/14, Fa0/15
- GREEN = Fa0/22, Fa0/6, Fa0/17
- RED = Fa0/1, Fa0/9, Fa0/10
- YELLOW = Fa0/3, Fa0/4, Fa0/20

**Switch2 (4 PCs)**
- ORANGE = Fa0/1, Fa0/2
- RED = Fa0/5
- BLUE = Fa0/8

**Switch3 (4 PCs + 2 servers)**
- GREEN = Fa0/3
- YELLOW = Fa0/4
- ORANGE = Fa0/5, Fa0/6
- BLUE ENROLLMENT server = Fa0/1
- GREEN ENROLLMENT server = Fa0/2

### Step 3: Trunks
On all 3 switches, configure Fa0/23 and Fa0/24 as trunk ports.

### Step 4: Connect and address
Cable type: **Copper Straight-Through**, PC FastEthernet0 → switch port. Mask 255.255.255.0, no gateway.

| PC | Color | Switch | Port | IP |
|----|-------|--------|------|----|
| PC0  | BLUE   | S1 | Fa0/13 | 192.168.100.10 |
| PC1  | BLUE   | S1 | Fa0/14 | 192.168.100.11 |
| PC2  | BLUE   | S1 | Fa0/15 | 192.168.100.12 |
| PC3  | GREEN  | S1 | Fa0/22 | 192.168.100.13 |
| PC4  | GREEN  | S1 | Fa0/6  | 192.168.100.14 |
| PC5  | GREEN  | S1 | Fa0/17 | 192.168.100.15 |
| PC6  | RED    | S1 | Fa0/1  | 192.168.100.16 |
| PC7  | RED    | S1 | Fa0/9  | 192.168.100.17 |
| PC8  | RED    | S1 | Fa0/10 | 192.168.100.18 |
| PC9  | YELLOW | S1 | Fa0/3  | 192.168.100.19 |
| PC10 | YELLOW | S1 | Fa0/4  | 192.168.100.20 |
| PC11 | YELLOW | S1 | Fa0/20 | 192.168.100.21 |
| PC12 | ORANGE | S2 | Fa0/1  | 192.168.100.22 |
| PC13 | ORANGE | S2 | Fa0/2  | 192.168.100.23 |
| PC14 | RED    | S2 | Fa0/5  | 192.168.100.24 |
| PC15 | BLUE   | S2 | Fa0/8  | 192.168.100.25 |
| PC16 | GREEN  | S3 | Fa0/3  | 192.168.100.26 |
| PC17 | YELLOW | S3 | Fa0/4  | 192.168.100.27 |
| PC18 | ORANGE | S3 | Fa0/5  | 192.168.100.28 |
| PC19 | ORANGE | S3 | Fa0/6  | 192.168.100.29 |
| BLUE ENROLLMENT  | BLUE  | S3 | Fa0/1 | 192.168.100.2 |
| GREEN ENROLLMENT | GREEN | S3 | Fa0/2 | 192.168.100.3 |

### Step 5: Test
| Test | Expected |
|------|----------|
| PC0 → PC15 (BLUE S1 → BLUE S2) | ✅ reply |
| PC0 → 192.168.100.2, then browser `192.168.100.2` | ✅ page loads |
| PC3 → PC16 (GREEN S1 → GREEN S3) | ✅ reply |
| PC3 → 192.168.100.3, then browser | ✅ page loads |
| PC6 → PC14 (RED S1 → RED S2) | ✅ reply |
| PC9 → PC17 (YELLOW S1 → YELLOW S3) | ✅ reply |
| PC12 → PC19 (ORANGE S2 → ORANGE S3) | ✅ reply |
| PC0 → PC3 (BLUE → GREEN) | ❌ timeout (correct) |
| PC6 → 192.168.100.2 (RED → BLUE server) | ❌ timeout (correct) |

**Target time:** under 15 minutes on the first run, under 8 once you're fast.

---

## Answer key (don't look until you're done)

**Same start on all 3 switches:**
```
en
conf t
no ip domain-l
vlan 100
name BLUE
vlan 200
name GREEN
vlan 300
name RED
vlan 400
name YELLOW
vlan 500
name ORANGE
int ra f0/23-24
sw mo tr
```

**Switch1, then add:**
```
int ra f0/13-15
sw mo acc
sw acc vl 100
int ra f0/22, f0/6, f0/17
sw mo acc
sw acc vl 200
int ra f0/1, f0/9-10
sw mo acc
sw acc vl 300
int ra f0/3-4, f0/20
sw mo acc
sw acc vl 400
end
wr
```

**Switch2, then add:**
```
int ra f0/1-2
sw mo acc
sw acc vl 500
int f0/5
sw mo acc
sw acc vl 300
int f0/8
sw mo acc
sw acc vl 100
end
wr
```

**Switch3, then add:**
```
int f0/1
sw mo acc
sw acc vl 100
int ra f0/2-3
sw mo acc
sw acc vl 200
int f0/4
sw mo acc
sw acc vl 400
int ra f0/5-6
sw mo acc
sw acc vl 500
end
wr
```
(Fa0/2 is the GREEN server and Fa0/3 is a GREEN PC, so one range covers both.)

# VLAN Exam Practice

Cisco Packet Tracer practice material for VLAN, trunk and DTP exams.

## Contents

| File | What it is |
|------|------------|
| [PRACTICE-EXAM-20PC.md](PRACTICE-EXAM-20PC.md) | 5 colors, 20 PCs, 3 switches. Step-by-step guide with answer key and timing targets |
| [PRACTICE-MIDTERM-VLAN.md](PRACTICE-MIDTERM-VLAN.md) | Multi-color VLANs plus an enrollment server (10 devices) |
| [VLAN-DTP-WITH-SERVER-ASS-2-MIDTERM.pkt](VLAN-DTP-WITH-SERVER-ASS-2-MIDTERM.pkt) | Packet Tracer practice file |
| [vlan-trainer/](vlan-trainer/) | Interactive timed trainer (HTML/CSS/JS, no build step) |
| [index.html](index.html), [guide.html](guide.html) | GitHub Pages landing page and Markdown viewer |

## Run locally

Open `index.html` in a browser. The guide viewer fetches Markdown files, so if
it fails from `file://`, serve the folder instead:

```
python -m http.server 8000
```

Then visit http://localhost:8000/.

## Publish on GitHub Pages

1. Push to `main`.
2. In the repo, go to Settings, then Pages.
3. Set the source to "Deploy from a branch", branch `main`, folder `/ (root)`.

The site will be at `https://<user>.github.io/<repo>/`. The `.nojekyll` file
stops GitHub from running Jekyll over the files.

## Cheat sheet

```
enable
conf t
no ip domain-lookup            ! stops DNS hangs on typos
vlan 100
 name BLUE
interface range fa0/12-13
 switchport mode access
 switchport access vlan 100
interface fa0/24
 switchport mode trunk
end
show vlan brief
show interfaces trunk
copy run start
```

# Run Club App – AI Context

## Project goal

This is a web application for a running club.

The purpose of the app is **not to replace TrainingPeaks**.
TrainingPeaks is used for training plans.

This app focuses on:
- motivation
- engagement
- gamification
- community feeling inside the club

Main idea: make running feel like a game.

---

# Tech stack

Frontend:
Next.js

Backend:
Supabase

Deployment:
Vercel

Database:
PostgreSQL (via Supabase)

---

# Core features

Users can:

- log workouts (runs)
- see other runners' workouts
- like workouts
- earn XP
- level up
- complete challenges
- compete in weekly leaderboards

---

# XP system

XP is earned from:

Workout completion  
50 XP per workout

Distance  
10 XP per kilometer

Likes  
5 XP per like

Challenges  
XP reward defined in the database field:

challenges.xp_reward

---

# Level system

Level formula:

level = floor(total_xp / 200) + 1

Next level XP:

next_level_xp = level * 200

Example:

Level 3  
420 / 600 XP

---

# Challenges

Challenges are stored in the table:

challenges

Important fields:

goal_km  
goal_runs  
xp_reward

Users complete challenges automatically based on runs.

Completion is stored in:

user_challenges

This ensures XP is awarded only once.

---

# Weekly race

The app has a weekly XP leaderboard.

Name in UI:

🔥 Гонка недели

Logic:

- calculate XP earned in the last 7 days
- sort users by XP
- show top 5
- show current user position
- show XP gap to the next position

---

# Dashboard structure

Dashboard page:

app/dashboard/page.tsx

Current layout:

1. Add workout button
2. User progress
3. Active challenge
4. Level card
5. Weekly race
6. Latest workouts

---

# UX principles

The app must feel:

- simple
- mobile-first
- game-like
- motivating

Avoid:

- complex admin panels
- overengineering
- heavy UI
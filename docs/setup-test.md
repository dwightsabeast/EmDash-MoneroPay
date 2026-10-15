# Coffer setup test (phase 05)

A timed fresh install, run by a person, to check the admin budget (spec, "Admin setup and upkeep"): under 15 minutes from the plugin's admin page to a settled test tip, with no help, two values typed once, one command on the wallet host and no software installed first.

Two runs, each on a freshly rolled-back wallet-host machine:

| Run | Monero node | What the installer should do |
| --- | --- | --- |
| A, own node | The shop owner's own stagenet node on the local network | Ask for a node (none runs on the wallet host itself); the tester gives the local node's address. The remote-node cross-check is off |
| B, remote node | A public stagenet node | Ask for a node; the tester gives the public node's address. The cross-check is on |

The registry click can't be timed yet (nothing is published). The plugin is already installed on the test site, and **the clock starts when the tester opens the plugin's admin page.** Phase 09 repeats the run from the registry.

This file has three parts:
- **Part 1, for the tester:** the admin-facing instructions, exactly as an admin would get them.
- **Part 2, the sheets:** a timing sheet and a confusion log, filled in by the observer.
- **Part 3, pass or fail.**

The organizer's checklist (machines, addresses, resets) is local to the dev box, in `~/xmr-pay-dev-data/05-setup/organizer.md`, because it describes the home network.

---

## Part 1. Set up Coffer: Monero payments for your site

You'll connect your site to your shop's Monero wallet. It takes about 15 minutes. You work in three places:

| Where | What it is |
| --- | --- |
| **Your wallet app** | Feather Wallet on your computer, with your new **shop wallet** open. |
| **Your site's admin** | Your EmDash site's admin pages, in your web browser. |
| **The wallet host** | A separate Linux machine that watches your shop wallet for payments. You'll paste one command into its terminal. It is **not** the machine your site runs on. |

Before you start you need:
- The address of your site's admin, and a login for it.
- A terminal on the wallet host, logged in as a user who can use `sudo`.
- Your shop wallet, already created in Feather Wallet (stagenet). This wallet is just for the shop, never your main wallet. Right after creating it, check its restore height (see "Before the clock" below): a wallet whose restore height is above the current block misses every payment, and it's easiest to fix before anything is paid to it.
- A second wallet with a little stagenet XMR, to send a test tip. The organizer has it ready for you.

If you get stuck, write down where and why, and keep going if you can. Don't ask for help unless you can't continue.

### Before the clock: get your wallet app ready (your wallet app)

Do this before step 1. It isn't timed: a real shop owner does it once, when they create the shop wallet.

1. **Restart Feather Wallet**, then open the shop wallet and the second wallet, and let both finish syncing.
2. **In each wallet, open Help → Debug info.** The wallet height must equal the daemon height.
3. **In the shop wallet's Debug info, find the restore height.** It must be **at or below the current block height** (the daemon height). A new 16-word (Polyseed) wallet can get a restore height in the future.
4. **If the shop wallet's restore height is too high,** restore it again now, while nothing has been paid to it (Feather can't change the restore height of an open wallet):
   1. Note the 16 words: **Wallet → Seed** shows them after the wallet password.
   2. **File → New/Restore**, then under "Restore wallet from…" choose **Seed**, and pick **16 word mnemonic seed (Polyseed)**. Enter the 16 words.
   3. On the seed page, click **Options** and tick **Override embedded wallet creation date**. Without it, Feather skips the restore height page.
   4. On the **Restore height** page, replace the value with a height a little below the current block (for example, the current block minus 1,000).
   5. Save it as a new wallet file, let it sync, and use this file as the shop wallet from now on.

**Check:** both wallets are synced, and the shop wallet's restore height is at or below the current block. Tell the observer you're ready; the clock starts at step 1.

### 1. Open the payments page (your site's admin)

In your browser, open your site's admin and sign in. In the menu, open **Monero payments**.

**Check:** the page starts with "Monero payments", and below it a section called **Setup: 1 of 5 done** (or a similar count).

### 2. Get your install command (your site's admin)

Under **Connect wallet host**, press **Connect wallet host**.

**Check:** a box says **Pairing code ready**, with the time it works until, and below it a command that starts with `if command -v curl`. The code in it works once, for 15 minutes.

Copy the whole command: all four lines, from `if` to the end of the line that starts with `fi`.

### 3. Run the command (the wallet host)

On the **wallet host**, not your site's server, paste the four lines into the terminal together and press Enter.

The command downloads the Coffer wallet host and checks it, then starts the installer. `sudo` may ask for your password on the wallet host.

### 4. Answer the questions (the wallet host)

The installer asks for two things from your shop wallet. In Feather Wallet, find them under **Wallet → Keys** (the address is also on the Receive tab):

1. **Primary address of the shop wallet:** paste the shop wallet's primary address.
2. **Private view key of the shop wallet:** paste the private view key. Nothing shows while you type or paste; that's expected. Press Enter.

If no Monero node runs on the wallet host, it says so and asks for a **Monero node address**. Type the node address you were given for this run, for example `http://<address>:<port>`.

The installer then works on its own: it downloads Monero's wallet program and checks its signature, creates a view-only copy of your shop wallet (it can see payments, it can't spend), sets up a background service and pairs with your site.

**Check:** it ends with **Done. The wallet host is installed and paired; the site's Monero payments page shows it as connected.**

### 5. Watch the checklist turn green (your site's admin)

Back on the Monero payments page, reload the page. The **Setup** section ticks off, one by one:

- Wallet host paired
- Wallet synced
- Payment addresses ready
- Price feed answering

**Check:** all four say **Done**. It can take a minute or two after the installer finishes; reload again if not.

Under the checklist, a line asks you to open your shop wallet app, let it finish syncing, and check a new wallet's restore height against a block number. If you did "Before the clock", that's already done.

### 6. Send a test tip (your site's admin, then the second wallet)

When the four items are done, press **Get a test address** under Setup. The page shows an address and, under it, a **payment link** (it starts with `monero:` and fills in the address and amount in most wallets). Use either one.

From the **second wallet** (not your shop wallet), send at least **0.0001 XMR** to that address. The organizer tells you how to send from it.

**Check:** after a minute or so, reloading the page shows **Payment seen**, and then the number of confirmations.

### 7. Setup complete (your site's admin)

Keep reloading every minute or two. Once the tip has enough confirmations (a few minutes on stagenet), the Setup section reads **Setup (complete)** and moves to the bottom of the page, under Settings. At the top of the page, a **Test tip received** section shows the amount, the block it arrived in, the time it settled and its Transaction ID.

**Check:** **Setup (complete)**, and the **Test tip received** section. Tell the observer the "settled at" time it shows.

### 8. Check your wallet app (your wallet app)

Open your shop wallet in Feather Wallet and let it sync.

**Check:** the test tip appears in the wallet's history with the amount the **Test tip received** section shows (its Transaction ID matches too). **Stop the clock here.**

If it isn't there after the wallet has synced, follow **Not in your wallet app?** under the Test tip received section: it says which block your wallet must be synced to and the highest restore height that works.

### If something goes wrong

- **The pairing code ran out** (more than 15 minutes, or the installer says the code was refused): press **Connect wallet host** again on the payments page and run the new command. The old code no longer works.
- **To see what the wallet host is doing**, on the wallet host run:

  ```sh
  sudo xmr-bridge status --config /etc/xmr-bridge/config
  ```

- **The installer's own record** of what it did (your answers are never written there):

  ```sh
  sudo cat /var/lib/xmr-bridge/log/install.log
  ```

- **A red line on the payments page** names its fix. Do what it says.

---

## Part 2. The sheets (observer)

The observer fills these in during the run, without helping. Times are wall-clock (HH:MM:SS). Start a new copy for each run.

**Run:** A (own node) / B (remote node) **Date:** ______ **Tester:** ______ **Observer:** ______

### Timing sheet

| # | Step (Part 1) | Start | End | Minutes | Done without help? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Open the payments page (**clock starts** at the page load) | | | | | |
| 2 | Connect wallet host, copy the command | | | | | |
| 3 | Paste and run on the wallet host, until the first question | | | | | |
| 4a | Primary address entered | | | | | |
| 4b | View key entered | | | | | |
| 4c | Node address entered (if asked) | | | | | |
| 4d | Installer says "Done" | | | | | |
| 5 | All four checklist items Done | | | | | |
| 6a | Get a test address | | | | | |
| 6b | Tip sent from the second wallet | | | | | |
| 6c | Payment seen on the page | | | | | |
| 7 | Setup (complete), with Test tip received at the top. Write its "settled at" time in Notes | | | | | |
| 8 | Tip visible in Feather, with its amount (**clock stops**) | | | | | |
| | **Total** (step 1 start to step 8 end) | | | | | |

Waiting time (installer downloads, sync, confirmations) counts: the budget is what the admin experiences.

Then split the total into the three parts below, so an overrun points at the right thing (run A attempt 2 settled in about 4 minutes but failed at about 16½, on the wallet app):

| Part | From | To | Minutes |
| --- | --- | --- | --- |
| Coffer's part | step 1 start | the page's "settled at" time | |
| The confirmation wait (inside Coffer's part) | 6c end | the page's "settled at" time | |
| The wallet app | the page's "settled at" time | step 8 end | |

Also note how long "Before the clock" took and whether the shop wallet needed a new restore. It isn't part of the total.

### Confusion log

One row for every hesitation (about 10 seconds or more), question, misreading, wrong click, error message or retry, even if the tester recovered alone.

| Time | Step | What happened (what they did, said or misread) | Recovered alone? | How long it cost |
| --- | --- | --- | --- | --- |
| | | | | |

### After the run, from the wallet host

The organizer collects these (the tester doesn't need to):

```sh
sudo xmr-bridge status --config /etc/xmr-bridge/config
```

```sh
sudo cat /var/lib/xmr-bridge/log/install.log
```

---

## Part 3. Pass or fail

A run **passes** only when all of these hold:

1. **Under 15 minutes** from the page load in step 1 to the wallet-app check in step 8.
2. **No help:** the observer gave no hint, answer or fix. A question the tester asked and then answered alone isn't help, but it goes in the confusion log.
3. **Two values typed once:** the shop wallet's address and view key, each entered once. The node address in a run that needs one doesn't count against this (spec: "a remote node only if your own monerod doesn't answer").
4. **One command on the wallet host:** the pasted install command. Checking commands from "If something goes wrong" are allowed but go in the confusion log.
5. **No software installed first** on the wallet host beyond what the clean machine has.
6. **The tip shows in the wallet app** with its amount (step 8). A tip settled on the site but missing from Feather fails the run (spec change 9).
7. **"Before the clock" was done first,** so a run measures setup, not a wallet created with a bad restore height. If it found a problem, note it; the run still counts.

Any overrun, error or confusion becomes a fix in the triage session (wording on the admin page, an installer message, a default, or a bug), and the run is repeated. The phase is done when both runs pass, or every overrun and confusion has a merged fix and the run has been repeated.

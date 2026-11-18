# IIPPT festival poster automation

Makes a poster in the IIPPT format for each occasion in the calendar, waits for your approval, and then posts it to the Facebook Page and Instagram.

## Folders
| Folder | What goes there |
|---|---|
| `assets/` | **You add:** `logo-left.png` (IIPPT banner) and `logo-right.png` (the two right-hand logos as one PNG with a transparent background) |
| `backgrounds/` | **You add:** artwork named after the occasion, e.g. `diwali.jpg`, `holi.png`, `janmashtami.webp`. Leave the year off the name so the image is reused every year. Use a square image, at least 1080×1080, with no text on it. Only use images you have the right to post. |
| `outbox/` | New posters waiting for your review (`poster.png` + `caption.txt`) |
| `approved/` | Approved posters. Each one posts on its date. |
| `posted/` | Done. `posted.json` holds the Facebook and Instagram post IDs. |

If an occasion has no background image, the script searches Openverse for one using the term in `extras.json` (`q`). It only takes CC0 or public-domain photos, which are free to use with no credit needed, and saves each one as `backgrounds/<name>.jpg` with a `.credit.txt` file next to it. If you don't like the pick, run `node poster.js make <id> --new-bg 1` (then 2, 3, and so on) for other options. If you drop your own image in, it always takes priority.

**Post times** are set by theme in `config.json`: spiritual 7:00, festive 7:30, national 8:00, global 9:00. You can override the time for a single occasion in `extras.json`, as is already done for New Year (00:05), Yoga Day (6:30) and Lohri (17:30).

**Song**: Each poster's `review.txt` suggests a song. Meta's API cannot attach music to posts, so if you want the song on Instagram, add it in the Instagram app.

## Running on GitHub (works with your PC off)
- **09:00 IST daily:** *Prepare posters* makes posters for the next 2 days and opens one GitHub Issue for each, with the poster image and caption.
- **Approve:** add the label `approved` to the issue. To try a different background, comment `/new-bg`. To skip a poster, close its issue.
- **On the day:** *Publish posters* posts it at its time and then closes the issue.
- **Secrets:** go to repo **Settings → Secrets and variables → Actions** and add `PAGE_ID`, `IG_USER_ID` and `PAGE_ACCESS_TOKEN`.
- **Run manually:** go to the **Actions** tab, pick a workflow, then click **Run workflow**. *Prepare posters* can be given more days.
- **Timing:** GitHub can start scheduled runs 5–20 minutes late, so a 7:00 post may go out around 7:15.

## Daily flow (on your own PC)
```
node poster.js upcoming        # makes posters for the next 2 days -> outbox/
node poster.js approve diwali-2027
node poster.js publish         # posts approved posters dated today
```
`node poster.js list --days 60` shows what's coming up. To change a poster, edit `occasions.json` (date, wording, hashtags) and run `node poster.js make <id>` again.

**Dates marked `verify` follow the lunar calendar and are approximate. Check them against a panchang before you approve.**

## One-time Meta setup (do this yourself, about 20 min)
1. Go to developers.facebook.com, create an app (type **Business**), and add the **Instagram Graph API** product. You don't need to submit the app for review, because it only posts to your own Page.
2. In **Graph API Explorer**, select your app and ask for these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`. Then generate a User token.
3. Swap that token for a long-lived one (Access Token Debugger → "Extend"). Then call `GET /me/accounts`. The Page `access_token` it returns does not expire.
4. Get the IDs: the Page `id` comes from `/me/accounts`, and the Instagram ID comes from `GET /{page-id}?fields=instagram_business_account`.
5. Copy `secrets.example.json` to `secrets.json`, fill it in, and run `node poster.js check-meta`.

Keep `secrets.json` private. Anyone who has the token can post as the college.

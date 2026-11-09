# Project Rules

## GitHub Project board

Tickets are tracked on the GitHub Project "earnm MVP": https://github.com/users/LanHuong142002/projects/2 (owner `LanHuong142002`, number `2`).

Whenever the Tracker Pack changes a ticket's status label, also move its card on the board to the matching Status. A board update never stops the work: if it fails, say so, save it with `ourkit pending add`, and carry on.

| Tracker status | Board Status | Option id |
|---|---|---|
| In progress | In Progress | `704a36aa` |
| In review | In Review | `ef422f80` |
| Blocked | Blocked | `8d6cfbff` |

Done needs no action: GitHub moves a card to Done when its issue closes on merge. Never set Done yourself.

Find the card for an issue, then set its Status:

```
gh project item-list 2 --owner LanHuong142002 --limit 200 --format json --jq '.items[] | select(.content.number == <issue-number>) | .id'
gh project item-edit --project-id PVT_kwHOBZjrp84Bq0Au --id <item-id> --field-id PVTSSF_lAHOBZjrp84Bq0AuzhpJaGQ --single-select-option-id <option-id>
```

When a new ticket is created, for example by an Epic split, add it to the board with Status Todo (option id `1cba04d0`):

```
gh project item-add 2 --owner LanHuong142002 --url <issue-url> --format json --jq .id
```

Then set its Status with `gh project item-edit` as above.

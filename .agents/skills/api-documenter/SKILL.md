---
name: api-documenter
description: >
  Use this skill whenever a new API route is created, an existing API route is modified, or the user asks to document an API. Triggers include: "document this API", "add this to the API docs", "I created a new route", "update the API docs", "log this endpoint", "new API added", or any time code for a new Express/Node route, controller, or endpoint is written or changed. Always use this skill proactively — if a new route file is created or an existing one is modified, run this skill without waiting to be asked.
---

# API Documenter

Maintains a single living `API_DOCS.md` file in the project root. Every time a new API is created or an existing one changes, this skill adds or updates its entry in that file.

---

## Your Job

1. Extract API details from the code or conversation
2. Read the existing `API_DOCS.md` (if it exists)
3. Add a new entry or update the matching existing entry
4. Write the file back

---

## Step 1 — Extract API Details

Collect all of the following. If any are missing or ambiguous, infer from the code context before asking. Only ask if it genuinely cannot be determined.

| Field | How to find it |
|-------|---------------|
| **API URL** | The route path, e.g. `/api/hrm/employees` or `/api/hrm/branches/:id` |
| **Method** | HTTP verb: GET, POST, PATCH, PUT, DELETE |
| **Auth** | Check for middleware like `auth`, `requireRole`, `branchScope`. If none → Public. If present → Authenticated (specifying roles/scopes) |
| **Request fields** | Body params (POST/PUT/PATCH), URL params (`:id`), query params (`?status=`) |
| **Expected responses** | Success shape + error cases from the controller logic |

---

## Step 2 — Read Existing Docs

Check if `API_DOCS.md` exists at the project root.

- If it **exists**: read it fully before editing — never overwrite entries that aren't changing
- If it **does not exist**: create it fresh with the header below

```markdown
# API Documentation — <Project Name>

> Auto-maintained. Do not edit manually — update via the api-documenter skill.

---
```

Replace `<Project Name>` with the actual project name from context (e.g. "Attendy HRMS").

---

## Step 3 — Format the API Entry

Use this exact template for each entry:

```markdown
## [METHOD] /path/to/endpoint

**Auth:** Public | Authenticated [Roles]  
**Description:** One clear sentence on what this endpoint does.

### Request

**URL Params** *(if any)*
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | UUID of the resource |

**Query Params** *(if any)*
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Filter by status: `open` or `resolved` |

**Body** *(for POST / PUT / PATCH)*
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Resource name |
| `email` | string | ✅ | Resource email address |

### Response

**Success — `2XX`**
```json
{
  "success": true,
  "data": {}
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing or invalid fields / validation error |
| `401` | Unauthorized / Invalid or expired token |
| `403` | Forbidden / Insufficient permissions |
| `404` | Resource not found |
| `409` | Conflict / Already exists |
| `500` | Server error / Database failure |

---
```

**Rules:**
- Omit sections that don't apply (e.g. no "URL Params" section for a route with no params)
- For GET-only endpoints with no body, omit the Body table entirely
- Always end the entry with `---` (horizontal rule) as a separator
- Validate-only fields (checked but not stored) go in the Body table with a note in the Description column

---

## Step 4 — Add or Update

**Adding a new API:**
Append the formatted entry after the last `---` in the file.

**Updating an existing API:**
- Match by METHOD + path (e.g. `## POST /api/hrm/auth/login`)
- Replace the entire entry from the `##` heading down to (and including) the next `---`
- Do not touch any other entries

---

## Step 5 — Write the File

Write the updated content back to `API_DOCS.md`. Then confirm to the user with a one-line summary:

> ✅ `API_DOCS.md` updated — added `POST /api/hrm/employees` (Authenticated [owner, branch_manager])

Or for an update:

> ✅ `API_DOCS.md` updated — modified `GET /api/hrm/employees/:id`

---

## Multi-API Batches

If multiple routes are created or changed at once (e.g. a whole routes file), process all of them in a single pass — read once, write once. List all the routes updated in your confirmation message.

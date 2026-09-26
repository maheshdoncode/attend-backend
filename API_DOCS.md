# API Documentation — Attendy HRMS

> Auto-maintained. Do not edit manually — update via the api-documenter skill.

---

## GET /api/health

**Auth:** Public  
**Description:** Health check endpoint to verify backend service uptime and status.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "status": "healthy",
  "uptime": 124.52,
  "timestamp": "2026-09-17T12:00:00.000Z"
}
```

---

## POST /api/hrm/auth/login

**Auth:** Public  
**Description:** Authenticates a user with email and password and returns a 24-hour JWT token with scoped branch IDs for managers.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | ✅ | User's registered email address |
| `password` | string | ✅ | User's plain text password |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Jane Doe",
    "email": "jane@company.com",
    "role": "branch_manager",
    "branchIds": [
      "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
    ]
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing email or password (`VALIDATION_ERROR`) |
| `401` | Invalid email or password (`INVALID_CREDENTIALS`) |
| `403` | User account is deactivated (`ACCOUNT_DEACTIVATED`) |
| `500` | Database or server error |

---

## GET /api/hrm/auth/me

**Auth:** Authenticated (`owner`, `branch_manager`, `employee`)  
**Description:** Fetches current authenticated user profile, employee profile details, and assigned branches.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "user": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Jane Doe",
    "email": "jane@company.com",
    "role": "employee",
    "is_active": true,
    "created_at": "2026-09-01T08:00:00.000Z",
    "profile": {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "user_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "employee_code": "EMP001",
      "department": "Engineering",
      "monthly_salary": 65000.00,
      "joined_date": "2026-01-15"
    },
    "branches": [
      {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "name": "Headquarters",
        "address": "123 Tech Park, Surat"
      }
    ],
    "lunch_tracking_mode": "inherit",
    "is_lunch_tracking_enabled": true
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `401` | Unauthorized / Missing or expired Bearer token |
| `404` | User not found (`USER_NOT_FOUND`) |
| `500` | Database or server error |

---

## PUT /api/hrm/auth/change-password

**Auth:** Authenticated (`owner`)  
**Description:** Allows the owner to change their own password or any user's password directly.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `new_password` | string | ✅ | New plain text password (minimum 6 characters) |
| `user_id` | string | — | Target User UUID (defaults to owner's own ID if omitted) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Password changed successfully for Alex Smith",
  "user": {
    "id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "name": "Alex Smith",
    "email": "alex@gmail.com",
    "role": "employee"
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing `new_password` or shorter than 6 characters (`VALIDATION_ERROR`) |
| `401` | Unauthorized / Missing or expired Bearer token |
| `403` | Forbidden / Non-owner role attempting password change |
| `404` | Target user not found |
| `500` | Database or server error |

---

## GET /api/hrm/employees/next-code

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Generates the next sequential available employee code based on existing records in the database (e.g. `EMP001`, `EMP002`, `EMP003`).

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "next_code": "EMP002"
}
```

**Errors**
| Code | Reason |
|------|--------|
| `401` | Unauthorized / Missing or invalid token |
| `403` | Forbidden / Insufficient permissions |
| `500` | Server or database error |

---

## GET /api/hrm/employees/search

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Fast, debounced lightweight employee search endpoint returning basic employee identity, email, code, and department.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | No | Search query term (matches name, email, or employee code) |
| `limit` | number | No | Number of records to return (default: `10`, max: `50`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "employees": [
    {
      "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Alex Smith",
      "email": "alex@company.com",
      "role": "employee",
      "employee_code": "EMP001",
      "department": "Operations",
      "is_active": true
    }
  ]
}
```

---

## POST /api/hrm/employees

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Creates a new employee or branch manager with hashed password, employee profile, and branch assignments. Branch managers can only assign branches within their own scope. `employee_code` is optional and automatically generated sequentially (`EMP001`, `EMP002`, etc.) if omitted.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Full name |
| `email` | string | ✅ | Unique email address |
| `password` | string | ✅ | Initial account password (minimum 6 characters) |
| `role` | string | ✅ | Either `'employee'` or `'branch_manager'` |
| `department` | string | — | Department name (default: `'General'`) |
| `monthly_salary` | number | — | Monthly gross salary (default: `0`) |
| `joined_date` | string | — | Date joined in `YYYY-MM-DD` |
| `employee_code` | string | — | Custom employee code (auto-generated if omitted) |
| `branch_ids` | array[string] | — | List of branch UUIDs to assign |
| `shift_assignments` | array[object] | — | List of `{ schedule_id, salary }` objects |
| `lunch_tracking_mode` | string | — | `'inherit'` (default), `'enabled'`, or `'disabled'` |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "employee": {
    "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "name": "Alex Smith",
    "email": "alex@company.com",
    "role": "employee",
    "is_active": true,
    "lunch_tracking_mode": "inherit",
    "created_at": "2026-09-17T12:00:00.000Z",
    "profile": {
      "id": "d1e2f3a4-b5c6-7d8e-9f0a-1b2c3d4e5f6a",
      "user_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "employee_code": "EMP001",
      "department": "Operations",
      "monthly_salary": 45000,
      "joined_date": "2026-09-01"
    },
    "branch_ids": [
      "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"
    ]
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing required fields or invalid role (`INVALID_ROLE`) |
| `403` | Branch manager attempted assigning out-of-scope branch (`FORBIDDEN_BRANCH`) |
| `409` | Email already exists (`EMAIL_EXISTS`) |
| `500` | Database or server error |

---

## GET /api/hrm/employees

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Lists employees and branch managers with profiles and branch assignments. Branch managers are automatically scoped to their authorized branches. For `branch_manager` callers, `monthly_salary` is hidden unless viewing their own record; `owner` can see all salaries.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `branch_id` | string | No | Filter by specific branch UUID |
| `role` | string | No | Filter by role (`employee`, `branch_manager`) |
| `search` | string | No | Search by name or email substring |
| `page` | number | No | Page number (default: `1`) |
| `limit` | number | No | Records per page (default: `20`, max: `100`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "total": 1,
  "page": 1,
  "limit": 20,
  "employees": [
    {
      "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Alex Smith",
      "email": "alex@company.com",
      "role": "employee",
      "is_active": true,
      "employee_code": "EMP102",
      "department": "Operations",
      "monthly_salary": 45000,
      "joined_date": "2026-09-01",
      "branches": [
        {
          "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "name": "Headquarters",
          "address": "123 Tech Park, Surat"
        }
      ]
    }
  ]
}
```

---

## GET /api/hrm/employees/:id

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Retrieves full employee details including profile, schedule override, and assigned branches. If requested by a `branch_manager` for another staff member, `monthly_salary` is automatically omitted from `profile` for privacy.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Employee User UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "employee": {
    "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "name": "Alex Smith",
    "email": "alex@company.com",
    "role": "employee",
    "is_active": true,
    "created_at": "2026-09-17T12:00:00.000Z",
    "profile": {
      "employee_code": "EMP102",
      "department": "Operations",
      "monthly_salary": 45000,
      "joined_date": "2026-09-01"
    },
    "schedule": {
      "id": "e47ac10b-58cc-4372-a567-0e02b2c3d479",
      "name": "Night Shift",
      "start_time": "20:00:00",
      "end_time": "05:00:00",
      "is_default": false
    },
    "schedule_override_id": "e47ac10b-58cc-4372-a567-0e02b2c3d479",
    "branches": [
      {
        "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
        "name": "Headquarters"
      }
    ]
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `403` | Branch manager does not have permission for this employee |
| `404` | Employee not found |

---

## PUT /api/hrm/employees/:id

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Updates employee user information, profile fields, branch assignments, and schedule override. Note: `monthly_salary` can only be modified by `owner`.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Employee User UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Full name |
| `department` | string | — | Department name |
| `monthly_salary` | number | — | Updated monthly salary (`owner` only) |
| `joined_date` | string | — | Join date `YYYY-MM-DD` |
| `employee_code` | string | — | Unique employee code |
| `branch_ids` | array[string] | — | New list of assigned branch UUIDs |
| `schedule_id` | string \| null | — | Specific schedule ID to override (or `null` to clear) |
| `lunch_tracking_mode` | string | — | `'inherit'`, `'enabled'`, or `'disabled'` |
| `is_active` | boolean | — | Active status |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Employee updated successfully"
}
```

---

## DELETE /api/hrm/employees/:id

**Auth:** Authenticated (`owner`)  
**Description:** Performs a soft delete by setting `is_active = false`.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Employee User UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Employee successfully deactivated (soft deleted)"
}
```

---

## GET /api/hrm/employees/:id/password

**Auth:** Authenticated (`owner`)  
**Description:** Fetches the current plain text password for any employee, branch manager, or user. Accessible exclusively by the owner.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | User UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "user_id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
  "name": "Alex Smith",
  "email": "alex@gmail.com",
  "role": "employee",
  "is_active": true,
  "current_password": "password123"
}
```

**Errors**
| Code | Reason |
|------|--------|
| `401` | Unauthorized / Missing or expired token |
| `403` | Forbidden / Non-owner role attempting password viewing |
| `404` | User not found |
| `500` | Database or server error |

---

## PUT /api/hrm/employees/:id/password

**Auth:** Authenticated (`owner`)  
**Description:** Updates the password for a specified employee, branch manager, or user. Re-hashes with bcrypt and updates `current_password`. Accessible exclusively by the owner.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | User UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `new_password` | string | ✅ | New plain text password (minimum 6 characters) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Password changed successfully for Alex Smith",
  "user": {
    "id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "name": "Alex Smith",
    "email": "alex@gmail.com",
    "role": "employee"
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing `new_password` or shorter than 6 characters (`VALIDATION_ERROR`) |
| `401` | Unauthorized / Missing or expired token |
| `403` | Forbidden / Non-owner role attempting password change |
| `404` | User not found |
| `500` | Database or server error |

---

## PUT /api/hrm/employees/:id/status

**Auth:** Authenticated (`owner`)  
**Description:** Activates or deactivates any user account (`is_active = true | false`). Deactivated accounts cannot log in. Accessible exclusively by the owner.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | User UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `is_active` | boolean | ✅ | `true` to activate, `false` to deactivate |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "User account deactivated successfully",
  "user": {
    "id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "name": "Alex Smith",
    "email": "alex@gmail.com",
    "role": "employee",
    "is_active": false
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Missing boolean `is_active` or owner attempting self-deactivation |
| `401` | Unauthorized / Missing or expired token |
| `403` | Forbidden / Non-owner role attempting status update |
| `404` | User not found |
| `500` | Database or server error |

---

## POST /api/hrm/employees/:id/schedule

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Upserts a work schedule override for a specific employee.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Employee User UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schedule_id` | string | ✅ | Work schedule UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Employee schedule override applied successfully",
  "override": {
    "employee_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "schedule_id": "e47ac10b-58cc-4372-a567-0e02b2c3d479"
  }
}
```

---

## DELETE /api/hrm/employees/:id/schedule

**Auth:** Authenticated (`owner`)  
**Description:** Deletes an employee's schedule override, falling back to the organization's default schedule.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Employee User UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Schedule override removed; employee will use the default work schedule."
}
```

---

## POST /api/hrm/branches

**Auth:** Authenticated (`owner`)  
**Description:** Creates a new branch with coordinates, radius, QR mode, and auto-generated 32-character hex secret.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Branch name |
| `address` | string | — | Physical street address |
| `latitude` | number | ✅ | GPS Latitude |
| `longitude` | number | ✅ | GPS Longitude |
| `radius_meters` | number | — | Allowed geofence radius in meters (default: `100`) |
| `qr_type` | string | — | `'static'` or `'dynamic'` (default: `'static'`) |
| `lunch_tracking_mode` | string | — | `'inherit'` (default), `'enabled'`, or `'disabled'` |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "branch": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Headquarters",
    "address": "123 Tech Park, Surat",
    "latitude": 21.1702,
    "longitude": 72.8311,
    "radius_meters": 150,
    "qr_secret": "e1f9c34d852a4e98b0f7193c72bca531",
    "qr_type": "dynamic",
    "lunch_tracking_mode": "inherit",
    "is_active": true,
    "created_at": "2026-09-17T12:00:00.000Z"
  }
}
```

---

## GET /api/hrm/branches

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Lists active branches. Branch managers only receive branches they are assigned to manage.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "branches": [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "name": "Headquarters",
      "address": "123 Tech Park, Surat",
      "latitude": 21.1702,
      "longitude": 72.8311,
      "radius_meters": 150,
      "qr_type": "dynamic",
      "is_active": true
    }
  ]
}
```

---

## GET /api/hrm/branches/:id

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Retrieves a branch by ID with scope validation.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Branch UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "branch": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Headquarters",
    "address": "123 Tech Park, Surat",
    "latitude": 21.1702,
    "longitude": 72.8311,
    "radius_meters": 150,
    "qr_type": "dynamic"
  }
}
```

---

## PUT /api/hrm/branches/:id

**Auth:** Authenticated (`owner`)  
**Description:** Updates branch details, geofence radius, and QR mode.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Branch UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Branch name |
| `address` | string | — | Physical address |
| `latitude` | number | — | GPS Latitude |
| `longitude` | number | — | GPS Longitude |
| `radius_meters` | number | — | Geofence radius |
| `qr_type` | string | — | `'static'` or `'dynamic'` |
| `lunch_tracking_mode` | string | — | `'inherit'`, `'enabled'`, or `'disabled'` |
| `is_active` | boolean | — | Active status |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "branch": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "name": "Headquarters Updated"
  }
}
```

---

## DELETE /api/hrm/branches/:id

**Auth:** Authenticated (`owner`)  
**Description:** Soft-deletes a branch (`is_active = false`).

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Branch UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Branch successfully deactivated (soft deleted)"
}
```

---

## GET /api/hrm/branches/:id/qr

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Generates and returns a Base64 PNG QR code for clocking in/out, payload JSON string, and expiry timestamp (for dynamic QR).

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Branch UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "qr_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "qr_type": "dynamic",
  "branch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "branch_name": "Headquarters",
  "payload_string": "{\"type\":\"dynamic\",\"secret\":\"e1f9c34d...\",\"branch_id\":\"9b1deb4d...\",\"ts\":2981240}",
  "expires_at": "2026-09-17T12:01:00.000Z"
}
```

---

## POST /api/hrm/branches/:id/qr/regenerate

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Rotates the branch's `qr_secret` and immediately returns the newly generated QR code.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Branch UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "qr_base64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "qr_type": "dynamic",
  "branch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "branch_name": "Headquarters",
  "payload_string": "{\"type\":\"dynamic\",\"secret\":\"new_secret_...\",\"branch_id\":\"9b1deb4d...\",\"ts\":2981240}",
  "expires_at": "2026-09-17T12:01:00.000Z"
}
```

---

## POST /api/hrm/attendance/clock-in

**Auth:** Authenticated (`employee`)  
**Description:** Processes employee shift clock-in by validating scanned QR payload, checking GPS geofence radius, verifying holiday status, calculating punctuality (`present`, `late`, `half_day`), and recording attendance.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `qr_payload` | string \| object | ✅ | Scanned QR code payload string or parsed JSON |
| `latitude` | number | ✅ | Device GPS Latitude |
| `longitude` | number | ✅ | Device GPS Longitude |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "attendance_id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
  "status": "present",
  "clock_in_time": "2026-09-17T09:04:15.123Z",
  "late_minutes": 4
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Invalid or expired QR code (`INVALID_QR`) |
| `400` | Device outside allowed branch radius (`OUT_OF_RADIUS`) |
| `400` | Today is a branch or global holiday (`HOLIDAY`) |
| `404` | Branch not found or inactive (`BRANCH_NOT_FOUND`) |
| `409` | Employee already clocked in today (`ALREADY_CLOCKED_IN`) |

---

## POST /api/hrm/attendance/clock-out

**Auth:** Authenticated (`employee`)  
**Description:** Closes the active shift for today after validating QR code and GPS location radius, calculating total hours worked.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `qr_payload` | string \| object | ✅ | Scanned QR code payload |
| `latitude` | number | ✅ | Device GPS Latitude |
| `longitude` | number | ✅ | Device GPS Longitude |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "clock_out_time": "2026-09-17T18:05:22.456Z",
  "hours_worked": 9.02
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | No active clock-in found for today (`NO_ACTIVE_CLOCK_IN`) |
| `400` | Outside branch radius or invalid QR code |

---

## POST /api/hrm/attendance/lunch-start

**Auth:** Authenticated (`employee`, `branch_manager`)  
**Description:** Starts the employee's lunch break for today's active shift. Records `lunch_start_time` and optional GPS coordinates. Break tracking does not affect salary calculations.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `latitude` | number | No | Device GPS Latitude at lunch start |
| `longitude` | number | No | Device GPS Longitude at lunch start |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Lunch break started",
  "data": {
    "id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "lunch_start_time": "2026-09-17T13:00:00.000Z",
    "is_on_lunch": true
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | No active clock-in found for today (`NO_ACTIVE_ATTENDANCE`) |
| `400` | Lunch break already started today (`LUNCH_ALREADY_STARTED`) |

---

## POST /api/hrm/attendance/lunch-end

**Auth:** Authenticated (`employee`, `branch_manager`)  
**Description:** Ends the employee's active lunch break. Records `lunch_end_time` and calculates total `lunch_duration_minutes`.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `latitude` | number | No | Device GPS Latitude at lunch end |
| `longitude` | number | No | Device GPS Longitude at lunch end |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Lunch break ended",
  "data": {
    "id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "lunch_start_time": "2026-09-17T13:00:00.000Z",
    "lunch_end_time": "2026-09-17T13:45:00.000Z",
    "lunch_duration_minutes": 45,
    "is_on_lunch": false
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | No active clock-in found for today (`NO_ACTIVE_ATTENDANCE`) |
| `400` | Lunch break has not been started yet (`LUNCH_NOT_STARTED`) |
| `400` | Lunch break already ended (`LUNCH_ALREADY_ENDED`) |

---

## GET /api/hrm/attendance

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Lists attendance records with employee names, codes, branch names, flag status, and lunch break durations. Branch managers are restricted to their assigned branches.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `branch_id` | string | No | Filter by branch UUID |
| `employee_id` | string | No | Filter by employee UUID |
| `date` | string | No | Specific date `YYYY-MM-DD` |
| `month` | number | No | Filter by month (`1`-`12`) |
| `year` | number | No | Filter by year (e.g. `2026`) |
| `status` | string | No | Filter by status (`present`, `late`, `half_day`, `absent`, `holiday`) |
| `flagged` | boolean | No | `true` or `false` |
| `page` | number | No | Page number (default: `1`) |
| `limit` | number | No | Page size (default: `20`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "total": 1,
  "page": 1,
  "limit": 20,
  "records": [
    {
      "id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "employee_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "employee_name": "Alex Smith",
      "employee_code": "EMP102",
      "department": "Operations",
      "branch_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "branch_name": "Headquarters",
      "date": "2026-09-17",
      "clock_in_time": "2026-09-17T09:04:15.123Z",
      "clock_out_time": "2026-09-17T18:05:22.456Z",
      "lunch_start_time": "2026-09-17T13:00:00.000Z",
      "lunch_end_time": "2026-09-17T13:45:00.000Z",
      "lunch_duration_minutes": 45,
      "is_on_lunch": false,
      "status": "present",
      "is_flagged": false,
      "flag_reason": null,
      "admin_notes": null
    }
  ]
}
```

---

## GET /api/hrm/attendance/daily-status

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Lists ALL active employees with their attendance status (`present`, `late`, `half_day`, `absent`, `not_marked`, `holiday`) for today or any specified date. Supports status filtering, branch filtering, and search.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | No | Target date in `YYYY-MM-DD` (defaults to today) |
| `branch_id` | string | No | Filter employees by branch UUID |
| `status` | string | No | Filter by status: `'all'`, `'present'`, `'absent'`, `'late'`, `'half_day'`, `'not_marked'` |
| `search` | string | No | Search employees by name or email |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "date": "2026-09-19",
  "summary": {
    "total_employees": 10,
    "present": 7,
    "late": 1,
    "half_day": 0,
    "absent": 1,
    "not_marked": 2
  },
  "employees": [
    {
      "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Alex Smith",
      "email": "alex@company.com",
      "employee_code": "EMP102",
      "department": "Operations",
      "branches": [
        {
          "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "name": "Headquarters",
          "address": "123 Tech Park, Surat"
        }
      ],
      "is_present": true,
      "attendance_status": "present",
      "attendance_id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "clock_in_time": "2026-09-19T09:04:15.123Z",
      "clock_out_time": "2026-09-19T18:05:22.456Z",
      "is_flagged": false,
      "flag_reason": null,
      "admin_notes": null
    },
    {
      "id": "b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e",
      "name": "Sara Johnson",
      "email": "sara@company.com",
      "employee_code": "EMP103",
      "department": "Marketing",
      "branches": [
        {
          "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
          "name": "Headquarters",
          "address": "123 Tech Park, Surat"
        }
      ],
      "is_present": false,
      "attendance_status": "not_marked",
      "attendance_id": null,
      "clock_in_time": null,
      "clock_out_time": null,
      "is_flagged": false,
      "flag_reason": null,
      "admin_notes": null
    }
  ]
}
```

---

## GET /api/hrm/attendance/my

**Auth:** Authenticated (`employee`)  
**Description:** Retrieves the logged-in employee's own attendance records.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `month` | number | No | Month (`1`-`12`) |
| `year` | number | No | Year (e.g. `2026`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "records": [
    {
      "id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "date": "2026-09-17",
      "branch_name": "Headquarters",
      "clock_in_time": "2026-09-17T09:04:15.123Z",
      "clock_out_time": "2026-09-17T18:05:22.456Z",
      "status": "present",
      "is_flagged": false
    }
  ]
}
```

---

## PUT /api/hrm/attendance/:id/resolve

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Manually resolves a flagged or unclosed attendance record with a clock-out time and admin notes.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Attendance UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `clock_out_time` | string | — | Manual clock out ISO timestamp |
| `notes` | string | — | Administrative reason/notes |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "record": {
    "id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "is_flagged": false,
    "clock_out_time": "2026-09-17T18:00:00.000Z",
    "admin_notes": "Employee forgot to clock out at exit; confirmed by supervisor"
  }
}
```

---

## POST /api/hrm/attendance/manual

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Allows owner or branch manager to manually log a clock-in or clock-out punch for any employee (e.g. if the employee forgot their phone or had device issues).

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `employee_id` | string | ✅ | Employee User UUID |
| `action` | string | ✅ | `'clock_in'` or `'clock_out'` |
| `branch_id` | string | — | Branch UUID (defaults to employee's assigned branch) |
| `time` | string | — | Custom ISO timestamp (defaults to current server time) |
| `admin_notes` | string | — | Reason or admin note for manual punch |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Clocked in manually",
  "record": {
    "id": "7c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "employee_id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "branch_id": "5c21f7b8-0436-41e7-8845-17a3bd0d0735",
    "date": "2026-09-19",
    "clock_in_time": "2026-09-19T09:00:00.000Z",
    "clock_out_time": null,
    "status": "present",
    "is_flagged": false,
    "admin_notes": "Manual Clock-In by Admin"
  }
}
```

---

## POST /api/hrm/attendance/auto-flag

**Auth:** Protected by Header (`x-cron-secret` or `Authorization: Bearer <CRON_SECRET>`)  
**Description:** Internal scheduled cron job (run at shift end) to flag missing clock-outs (`is_flagged = true`) and mark absent employees who did not clock in on non-holiday weekdays.

### Request

**Headers**
| Header | Type | Description |
|--------|------|-------------|
| `x-cron-secret` | string | Value matching `CRON_SECRET` environment variable |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "date": "2026-09-17",
  "flagged_missing_clockout": 3,
  "marked_absent": 5
}
```

**Errors**
| Code | Reason |
|------|--------|
| `401` | Invalid or missing cron secret header (`UNAUTHORIZED_CRON`) |

---

## POST /api/hrm/schedules

**Auth:** Authenticated (`owner`)  
**Description:** Creates a work schedule shift. Setting `is_default = true` automatically unsets default flag on all other shifts.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Schedule name (e.g. `'General Shift'`) |
| `start_time` | string | ✅ | Shift start time in `'HH:MM'` |
| `end_time` | string | ✅ | Shift end time in `'HH:MM'` |
| `is_default` | boolean | — | Set as default organizational shift (default: `false`) |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "schedule": {
    "id": "e47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "General Shift",
    "start_time": "09:00:00",
    "end_time": "18:00:00",
    "is_default": true,
    "created_at": "2026-09-17T12:00:00.000Z"
  }
}
```

---

## GET /api/hrm/schedules

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Lists all work schedules.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "schedules": [
    {
      "id": "e47ac10b-58cc-4372-a567-0e02b2c3d479",
      "name": "General Shift",
      "start_time": "09:00:00",
      "end_time": "18:00:00",
      "is_default": true
    }
  ]
}
```

---

## PUT /api/hrm/schedules/:id

**Auth:** Authenticated (`owner`)  
**Description:** Updates a work schedule.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Work schedule UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Shift name |
| `start_time` | string | — | Start time `'HH:MM'` |
| `end_time` | string | — | End time `'HH:MM'` |
| `is_default` | boolean | — | Set as default schedule |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "schedule": {
    "id": "e47ac10b-58cc-4372-a567-0e02b2c3d479",
    "name": "General Shift",
    "start_time": "09:30:00",
    "end_time": "18:30:00",
    "is_default": true
  }
}
```

---

## DELETE /api/hrm/schedules/:id

**Auth:** Authenticated (`owner`)  
**Description:** Deletes a schedule. Blocks deletion if it is the only default schedule remaining.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Work schedule UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Schedule deleted successfully"
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Cannot delete the only default schedule (`CANNOT_DELETE_DEFAULT`) |

---

## POST /api/hrm/holidays

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Adds a holiday for a specific branch or globally (`null` branch_id). Branch managers can only create branch-specific holidays for their managed branches.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | ✅ | Holiday date in `YYYY-MM-DD` |
| `name` | string | ✅ | Holiday name (e.g. `'Diwali'`) |
| `branch_id` | string \| null | — | Branch UUID (or `null` for global) |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "holiday": {
    "id": "5c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "date": "2026-10-31",
    "name": "Diwali",
    "branch_id": null,
    "created_at": "2026-09-17T12:00:00.000Z"
  }
}
```

---

## GET /api/hrm/holidays

**Auth:** Authenticated (`owner`, `branch_manager`, `employee`)  
**Description:** Lists holidays matching the specified branch or global holidays.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `branch_id` | string | No | Filter by branch UUID |
| `month` | number | No | Month (`1`-`12`) |
| `year` | number | No | Year (e.g. `2026`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "holidays": [
    {
      "id": "5c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "date": "2026-10-31",
      "name": "Diwali",
      "branch_id": null,
      "branch_name": "All Branches (Global)",
      "created_at": "2026-09-17T12:00:00.000Z"
    }
  ]
}
```

---

## DELETE /api/hrm/holidays/:id

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Deletes a holiday record.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Holiday UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Holiday removed successfully"
}
```

---

## POST /api/hrm/working-days

**Auth:** Authenticated (`owner`)  
**Description:** Marks a specific date (such as a Sunday) as an official working day for all employees, a specific branch, or an individual employee. If an employee takes leave or is absent on a working Sunday, daily salary is deducted.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | ✅ | Working date in `YYYY-MM-DD` |
| `branch_id` | string \| null | — | Branch UUID (or `null` for all branches) |
| `employee_id` | string \| null | — | Specific employee UUID (or `null` for all employees) |
| `reason` | string | — | Note/reason (e.g. `'Special Sprint Sunday'`) |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "message": "Working day override successfully added for 2026-09-20",
  "working_day": {
    "id": "7d1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "date": "2026-09-20",
    "branch_id": null,
    "employee_id": null,
    "reason": "Special Sprint Sunday",
    "created_at": "2026-09-19T12:00:00.000Z",
    "branches": null,
    "users": null
  }
}
```

---

## GET /api/hrm/working-days

**Auth:** Authenticated (`owner`, `branch_manager`, `employee`)  
**Description:** Lists working day overrides (e.g. working Sundays) filtered by date, month, year, branch, or employee.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | No | Specific date `YYYY-MM-DD` |
| `month` | number | No | Month (`1`-`12`) |
| `year` | number | No | Year (e.g. `2026`) |
| `branch_id` | string | No | Filter by branch UUID |
| `employee_id` | string | No | Filter by employee UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "working_days": [
    {
      "id": "7d1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "date": "2026-09-20",
      "branch_id": null,
      "employee_id": null,
      "reason": "Special Sprint Sunday",
      "created_at": "2026-09-19T12:00:00.000Z"
    }
  ]
}
```

---

## DELETE /api/hrm/working-days/:id

**Auth:** Authenticated (`owner`)  
**Description:** Removes a working day override (reverting that Sunday/date back to a standard non-working day).

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Working day override UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Working day override successfully removed"
}
```

---

## POST /api/hrm/policies

**Auth:** Authenticated (`owner`)  
**Description:** Creates a new deduction policy for late arrival, absence, half day, or early departure.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ | Policy title (e.g. `'Late Arrival'`) |
| `condition_type` | string | ✅ | `'late_arrival'`, `'absent'`, `'half_day'`, or `'early_departure'` |
| `threshold_minutes` | number \| null | — | Grace period threshold in minutes (e.g. `10`) |
| `deduction_type` | string | — | `'fixed_minutes'`, `'half_day'`, or `'full_day'` |
| `deduction_minutes` | number \| null | — | Minutes deducted when `deduction_type` is `'fixed_minutes'` |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "policy": {
    "id": "8c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "name": "Late Arrival",
    "condition_type": "late_arrival",
    "threshold_minutes": 10,
    "deduction_type": "fixed_minutes",
    "deduction_minutes": 30,
    "is_active": true
  }
}
```

---

## GET /api/hrm/policies

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Lists all active deduction policies.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "policies": [
    {
      "id": "8c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "name": "Late Arrival",
      "condition_type": "late_arrival",
      "threshold_minutes": 10,
      "deduction_type": "fixed_minutes",
      "deduction_minutes": 30,
      "is_active": true
    },
    {
      "id": "9c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5e",
      "name": "Absent",
      "condition_type": "absent",
      "threshold_minutes": null,
      "deduction_type": "full_day",
      "deduction_minutes": null,
      "is_active": true
    }
  ]
}
```

---

## PUT /api/hrm/policies/:id

**Auth:** Authenticated (`owner`)  
**Description:** Updates an existing deduction policy.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Policy UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | — | Policy name |
| `threshold_minutes` | number \| null | — | Threshold minutes |
| `deduction_type` | string | — | Deduction type |
| `deduction_minutes` | number \| null | — | Deduction minutes |
| `is_active` | boolean | — | Active status |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "policy": {
    "id": "8c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "name": "Late Arrival (Updated)"
  }
}
```

---

## DELETE /api/hrm/policies/:id

**Auth:** Authenticated (`owner`)  
**Description:** Soft-deletes a deduction policy (`is_active = false`).

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Policy UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Deduction policy deactivated (soft deleted)"
}
```

---

## POST /api/hrm/payroll/generate

**Auth:** Authenticated (`owner`)  
**Description:** Generates monthly payroll calculations for active employees. Working days are Monday to Saturday plus any special working Sundays marked by the owner. Any branch/global holidays falling on working days are fully paid (no salary deduction). If an employee takes leave or is absent on a standard working day or a working Sunday, daily salary is deducted. Skips finalized payrolls.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `month` | number | ✅ | Month number (`1`-`12`) |
| `year` | number | ✅ | Year (e.g. `2026`) |
| `employee_ids` | array[string] | — | Specific employee UUIDs to process (omitted = all active) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Payroll processed for 1 employee(s)",
  "payroll": [
    {
      "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "employee_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "employee_name": "Alex Smith",
      "employee_code": "EMP102",
      "month": 9,
      "year": 2026,
      "working_days": 22,
      "present_days": 20,
      "absent_days": 1,
      "late_count": 1,
      "half_day_count": 0,
      "gross_salary": 45000.00,
      "total_deduction_amount": 2159.09,
      "net_salary": 42840.91,
      "status": "draft",
      "deduction_breakdown": [
        {
          "date": "2026-09-08",
          "reason": "Absent on 2026-09-08",
          "amount": 2045.45
        },
        {
          "date": "2026-09-15",
          "reason": "Late arrival on 2026-09-15 (25 min late)",
          "amount": 113.64
        }
      ]
    }
  ]
}
```

---

## GET /api/hrm/payroll

**Auth:** Authenticated (`owner`, `branch_manager`, `employee`)  
**Description:** Lists payroll summaries filtered by period, branch, and status. For `employee` callers, results are automatically scoped to their own payslips and only include finalized payrolls that are currently accessible based on their visibility mode (`hours`, `once`, `always`, `hidden`).

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `month` | number | No | Month (`1`-`12`) |
| `year` | number | No | Year (e.g. `2026`) |
| `employee_id` | string | No | Filter by employee UUID |
| `branch_id` | string | No | Filter by branch UUID |
| `status` | string | No | Filter by status (`draft`, `finalized`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "payroll": [
    {
      "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "employee_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "employee_name": "Alex Smith",
      "employee_code": "EMP001",
      "department": "Operations",
      "month": 9,
      "year": 2026,
      "working_days": 22,
      "present_days": 20,
      "absent_days": 1,
      "late_count": 1,
      "total_late_minutes": 25,
      "half_day_count": 0,
      "gross_salary": 45000.00,
      "earned_salary": 45000.00,
      "total_deduction_amount": 2159.09,
      "advance_deduction": 0,
      "net_salary": 42840.91,
      "status": "finalized",
      "visibility_mode": "hours",
      "visibility_hours": 24,
      "view_count": 1,
      "first_viewed_at": "2026-09-24T12:30:00.000Z",
      "last_viewed_at": "2026-09-24T14:15:00.000Z",
      "finalized_at": "2026-09-24T12:00:00.000Z",
      "is_visible_to_employee": false,
      "is_accessible_to_employee": true,
      "is_within_24h": true,
      "is_expired": false,
      "hours_remaining": 18.5,
      "expires_at": "2026-09-25T12:00:00.000Z",
      "status_label": "Visible (18.5h left)"
    }
  ]
}
```

---

## GET /api/hrm/payroll/:employee_id/:month/:year

**Auth:** Authenticated (`owner`, `employee [own only]`, `branch_manager [own only]`)  
**Description:** Retrieves full itemized payslip breakdown for an employee in a specific month and year. Non-owner users are strictly restricted to their own payslips. Employees can only access finalized payslips that satisfy the visibility mode (`hours` within limit, `once` if not yet viewed, `always`, or manual override). When an employee accesses a payslip for the first time in `once` mode, it is recorded and subsequent requests return `403 ONE_TIME_VIEW_EXPIRED`.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `employee_id` | string | Employee UUID |
| `month` | number | Month (`1`-`12`) |
| `year` | number | Year (e.g. `2026`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "payroll": {
    "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "employee_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
    "employee_name": "Alex Smith",
    "employee_code": "EMP001",
    "department": "Operations",
    "month": 9,
    "year": 2026,
    "working_days": 26,
    "present_days": 24,
    "absent_days": 1,
    "late_count": 1,
    "total_late_minutes": 25,
    "half_day_count": 0,
    "gross_salary": 45000.00,
    "earned_salary": 45000.00,
    "total_deduction_amount": 1846.15,
    "advance_deduction": 0,
    "net_salary": 43153.85,
    "status": "finalized",
    "visibility_mode": "hours",
    "visibility_hours": 24,
    "view_count": 1,
    "first_viewed_at": "2026-09-24T12:30:00.000Z",
    "last_viewed_at": "2026-09-24T14:15:00.000Z",
    "finalized_at": "2026-09-24T12:00:00.000Z",
    "is_visible_to_employee": false,
    "is_accessible_to_employee": true,
    "is_within_24h": true,
    "is_expired": false,
    "hours_remaining": 18.5,
    "expires_at": "2026-09-25T12:00:00.000Z",
    "deduction_breakdown": [
      {
        "date": "2026-09-08",
        "reason": "Absent on 2026-09-08",
        "amount": 1730.77
      },
      {
        "date": "2026-09-15",
        "reason": "Late arrival on 2026-09-15 (25 min late)",
        "amount": 115.38
      }
    ],
    "daily_records": []
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `403` | Non-owner attempted to access another employee's payslip (`FORBIDDEN`) |
| `403` | Payroll is still in draft state (`PAYROLL_NOT_FINALIZED`) |
| `403` | Time limit expired (`PAYROLL_VIEW_EXPIRED`, returns `{ is_expired: true }`) |
| `403` | One-time view already consumed (`ONE_TIME_VIEW_EXPIRED`, returns `{ is_expired: true, view_count: 1 }`) |
| `404` | Payroll record not found |

---

## PUT /api/hrm/payroll/:id/finalize

**Auth:** Authenticated (`owner`)  
**Description:** Finalizes a payroll record (`status = 'finalized'`), sets `finalized_at = now()`, initializes `view_count = 0`, and applies configured visibility mode and duration.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Payroll Record UUID |

**Body (Optional)**
| Field | Type | Description |
|-------|------|-------------|
| `visibility_mode` | string | `'hours'`, `'once'`, `'always'`, `'hidden'` (default: `'hours'`) |
| `visibility_hours` | number | Access window in hours when mode is `'hours'` (default: `24`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Payroll successfully finalized",
  "payroll": {
    "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "status": "finalized",
    "visibility_mode": "hours",
    "visibility_hours": 24,
    "finalized_at": "2026-09-24T12:00:00.000Z",
    "view_count": 0,
    "is_visible_to_employee": false,
    "is_accessible_to_employee": true,
    "is_within_24h": true,
    "is_expired": false,
    "hours_remaining": 24.0,
    "expires_at": "2026-09-25T12:00:00.000Z"
  }
}
```

---

## PUT /api/hrm/payroll/:id/visibility

**Auth:** Authenticated (`owner`)  
**Description:** Updates visibility mode (`hours`, `once`, `always`, `hidden`), sets custom duration, resets view count, resets countdown timer, or sets manual override.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Payroll Record UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `visibility_mode` | string | — | `'hours'`, `'once'`, `'always'`, `'hidden'` |
| `visibility_hours` | number | — | Custom duration in hours (e.g. `1`, `6`, `12`, `24`, `48`, `72`) |
| `is_visible` | boolean | — | Explicit override (`true` = always visible, `false` = hidden) |
| `reset_view` | boolean | — | If `true`, resets `view_count = 0` (grants 1 more view for `'once'` mode) |
| `reset_timer` | boolean | — | If `true`, resets `finalized_at = now()` (restarts duration countdown) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Visibility configuration updated successfully",
  "payroll": {
    "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "visibility_mode": "once",
    "visibility_hours": 24,
    "view_count": 0,
    "is_accessible_to_employee": true,
    "status_label": "One-Time (Not Viewed)"
  }
}
```

---

## PUT /api/hrm/payroll/:id

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Allows the owner to manually modify amounts, attendance day counts, and deduction line items for a draft payroll before finalizing it.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Payroll Record UUID |

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gross_salary` | number | — | Modified gross salary base |
| `earned_salary` | number | — | Modified earned salary for working days |
| `total_deduction_amount` | number | — | Total deductions amount |
| `advance_deduction` | number | — | Advance salary deduction component |
| `net_salary` | number | — | Final net payable salary |
| `working_days` | number | — | Total working days in month |
| `present_days` | number | — | Present days count |
| `absent_days` | number | — | Absent days count |
| `half_day_count` | number | — | Half days count |
| `late_count` | number | — | Late arrivals count |
| `total_late_minutes` | number | — | Total late minutes |
| `deduction_breakdown` | array[object] | — | Line-item list of deductions/bonuses (`{ date, type, reason, amount }`) |
| `admin_notes` | string | — | Audit explanation notes |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Draft payroll updated successfully",
  "payroll": {
    "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "gross_salary": 45000.00,
    "earned_salary": 42500.00,
    "total_deduction_amount": 2500.00,
    "net_salary": 40000.00,
    "status": "draft",
    "is_manually_edited": true,
    "edited_at": "2026-09-26T10:35:00.000Z"
  }
}
```

**Errors**
| Code | Reason |
|------|--------|
| `400` | Attempted editing a finalized payroll (`PAYROLL_ALREADY_FINALIZED`) |
| `404` | Payroll record not found |

---

## POST /api/hrm/payroll/:id/reset

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Restores the original attendance-calculated figures snapshot for a draft payroll, discarding all manual edits.

### Request

**URL Params**
| Param | Type | Description |
|-------|------|-------------|
| `id` | string | Payroll Record UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Payroll figures successfully reset to original calculation",
  "payroll": {
    "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
    "status": "draft",
    "is_manually_edited": false
  }
}
```

---

## PUT /api/hrm/payroll/bulk-visibility

**Auth:** Authenticated (`owner`)  
**Description:** Bulk updates visibility modes, durations, or resets for multiple payroll records.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payroll_ids` | array[string] | ✅ | Array of payroll record UUIDs |
| `visibility_mode` | string | — | `'hours'`, `'once'`, `'always'`, `'hidden'` |
| `visibility_hours` | number | — | Custom duration in hours |
| `is_visible` | boolean | — | Explicit override |
| `reset_view` | boolean | — | Reset `view_count = 0` for selected records |
| `reset_timer` | boolean | — | Reset `finalized_at = now()` for selected records |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Updated visibility for 5 payroll record(s)",
  "updated_count": 5
}
```

---

## GET /api/hrm/payroll/settings/visibility

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Retrieves the organization's company-wide default payroll visibility settings used when finalizing payrolls.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "settings": {
    "visibility_mode": "hours",
    "visibility_hours": 24
  }
}
```

---

## PUT /api/hrm/payroll/settings/visibility

**Auth:** Authenticated (`owner`)  
**Description:** Updates the company-wide default payroll visibility configuration and optionally syncs all existing finalized payroll records.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `visibility_mode` | string | — | `'hours'`, `'once'`, `'always'`, `'hidden'` |
| `visibility_hours` | number | — | Default duration in hours (e.g. `24`) |
| `apply_to_existing` | boolean | — | If `true`, applies this new policy to all existing finalized payroll records |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Global payroll visibility settings updated successfully",
  "settings": {
    "visibility_mode": "hours",
    "visibility_hours": 24
  },
  "applied_to_existing": true,
  "updated_count": 12
}
```

---

## GET /api/hrm/reports/attendance

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Retrieves a monthly attendance matrix report mapping every calendar day's status, clock-in/out timestamps, and hours worked per employee.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `month` | number | ✅ | Month number (`1`-`12`) |
| `year` | number | ✅ | Year (e.g. `2026`) |
| `branch_id` | string | No | Filter by branch UUID |
| `employee_id` | string | No | Filter by employee UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "month": 9,
  "year": 2026,
  "employees": [
    {
      "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Alex Smith",
      "employee_code": "EMP102",
      "department": "Operations",
      "days": [
        {
          "date": "2026-09-01",
          "status": "present",
          "clock_in": "2026-09-01T09:00:00.000Z",
          "clock_out": "2026-09-01T18:00:00.000Z",
          "hours_worked": 9.0
        }
      ]
    }
  ]
}
```

---

## GET /api/hrm/reports/payroll

**Auth:** Authenticated (`owner`)  
**Description:** Generates aggregate payroll summary metrics (total employees, total gross, total deductions, total net) and individual employee records. Accessible by owner only.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `month` | number | ✅ | Month number (`1`-`12`) |
| `year` | number | ✅ | Year (e.g. `2026`) |
| `branch_id` | string | No | Filter by branch UUID |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "month": 9,
  "year": 2026,
  "total_employees": 25,
  "total_gross": 1125000.00,
  "total_deductions": 42500.00,
  "total_net": 1082500.00,
  "records": [
    {
      "id": "6c1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "employee_id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
      "name": "Alex Smith",
      "employee_code": "EMP102",
      "department": "Operations",
      "gross_salary": 45000,
      "total_deduction_amount": 2159.09,
      "net_salary": 42840.91,
      "status": "draft"
    }
  ]
}
```

---

## GET /api/hrm/reports/export

**Auth:** Authenticated (`owner` for payroll & attendance; `branch_manager` for attendance only)  
**Description:** Generates and directly streams binary export files (`.xlsx` Excel spreadsheet for monthly attendance matrix, or `.pdf` document for payroll summary table).

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | ✅ | `'attendance'` or `'payroll'` (payroll is `owner` only) |
| `format` | string | — | `'excel'` (default for attendance) or `'pdf'` (default for payroll) |
| `month` | number | ✅ | Month number (`1`-`12`) |
| `year` | number | ✅ | Year (e.g. `2026`) |
| `branch_id` | string | No | Filter by branch UUID |

### Response

**Success — `200 OK` (Streamed File)**
---

## POST /api/hrm/advance-salary

**Auth:** Authenticated (`employee`, `branch_manager`, `owner`)  
**Description:** Submits an advance salary request. Employees/managers can request for themselves (status defaults to `pending`). Owners can issue advance directly for any employee with custom initial status (`approved` by default if not specified).

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `employee_id` | string (UUID) | No (defaults to current user if employee/manager; required if owner creating for another user) | Target employee UUID |
| `amount` | number | ✅ | Advance amount requested (must be > 0) |
| `reason` | string | No | Reason for the advance salary |
| `target_month` | number | No | Month (`1`-`12`) in which the advance will be deducted |
| `target_year` | number | No | Year (e.g. `2026`) in which the advance will be deducted |
| `status` | string | No | Initial status (`pending` or `approved`). Only owner can set to `approved` on creation. |
| `notes` | string | No | Internal notes or remarks |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "data": {
    "id": "7f8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
    "employee_id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "amount": 5000,
    "reason": "Medical emergency",
    "target_month": 9,
    "target_year": 2026,
    "status": "pending",
    "approved_by": null,
    "approved_at": null,
    "payroll_id": null,
    "deducted_at": null,
    "notes": null,
    "created_at": "2026-09-21T05:30:00.000Z"
  }
}
```

---

## GET /api/hrm/advance-salary

**Auth:** Authenticated (`employee`, `branch_manager`, `owner`)  
**Description:** Lists advance salary records with employee profile details and pagination. Employees only see their own records. Managers see records within their assigned branches. Owners see all records.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `employee_id` | string (UUID) | No | Filter by employee UUID |
| `branch_id` | string (UUID) | No | Filter by branch UUID |
| `status` | string | No | Filter by status (`pending`, `approved`, `rejected`, `deducted`) |
| `target_month` | number | No | Filter by target deduction month (`1`-`12`) |
| `target_year` | number | No | Filter by target deduction year |
| `page` | number | No | Page number (default: `1`) |
| `limit` | number | No | Results per page (default: `50`, max: `100`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "data": [
    {
      "id": "7f8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
      "employee_id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
      "amount": 5000,
      "reason": "Medical emergency",
      "target_month": 9,
      "target_year": 2026,
      "status": "approved",
      "approved_by": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "approved_at": "2026-09-21T06:00:00.000Z",
      "payroll_id": null,
      "deducted_at": null,
      "notes": "Approved by owner",
      "created_at": "2026-09-21T05:30:00.000Z",
      "employee": {
        "id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
        "name": "Alex Smith",
        "email": "alex@gmail.com",
        "role": "employee",
        "employee_profiles": {
          "employee_code": "EMP102",
          "monthly_salary": 45000,
          "department": "Operations"
        }
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1,
    "totalPages": 1
  }
}
```

---

## GET /api/hrm/advance-salary/summary

**Auth:** Authenticated (`employee`, `branch_manager`, `owner`)  
**Description:** Returns summary statistics of advance salaries: total pending amount/count, approved amount/count, deducted amount/count, and rejected count. Scoped to user's permissions.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `employee_id` | string (UUID) | No | Filter summary by employee |
| `branch_id` | string (UUID) | No | Filter summary by branch |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "summary": {
    "total_pending_amount": 5000,
    "total_pending_count": 1,
    "total_approved_amount": 10000,
    "total_approved_count": 2,
    "total_deducted_amount": 15000,
    "total_deducted_count": 3,
    "total_rejected_count": 0,
    "total_all_amount": 30000,
    "total_all_count": 6
  }
}
```

---

## GET /api/hrm/advance-salary/:id

**Auth:** Authenticated (`employee`, `branch_manager`, `owner`)  
**Description:** Fetches a specific advance salary record by UUID.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "data": {
    "id": "7f8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
    "employee_id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "amount": 5000,
    "reason": "Medical emergency",
    "target_month": 9,
    "target_year": 2026,
    "status": "approved",
    "approved_by": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "approved_at": "2026-09-21T06:00:00.000Z",
    "payroll_id": null,
    "deducted_at": null,
    "notes": null,
    "created_at": "2026-09-21T05:30:00.000Z"
  }
}
```

---

## PUT /api/hrm/advance-salary/:id/status

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Approves or rejects an advance salary request. Exclusively accessible by the Owner.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | ✅ | `'approved'` or `'rejected'` |
| `notes` | string | No | Optional notes explaining approval or rejection reason |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Advance salary approved successfully",
  "data": {
    "id": "7f8b9c0d-1e2f-3a4b-5c6d-7e8f9a0b1c2d",
    "status": "approved",
    "approved_by": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "approved_at": "2026-09-21T06:00:00.000Z",
    "notes": "Approved for emergency"
  }
}
```

---

## DELETE /api/hrm/advance-salary/:id

**Auth:** Authenticated (`employee`, `branch_manager`, `owner`)  
**Description:** Deletes/cancels an advance salary request. Employees can only delete their own `pending` requests. Owners can delete any request that has not yet been `deducted`.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Advance salary request deleted successfully"
}
```

---

## GET /api/hrm/users/passwords

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Securely retrieves the list of all employees and managers with their decrypted plain-text passwords. Only the Owner is authorized to access this endpoint.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "users": [
    {
      "id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
      "name": "Alex Smith",
      "email": "alex@gmail.com",
      "role": "employee",
      "employee_code": "EMP102",
      "department": "Operations",
      "is_active": true,
      "password": "DecryptedPassword123"
    }
  ]
}
```

---

## PUT /api/hrm/users/:id/password

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Changes any employee's or branch manager's password. Updates both the bcrypt hash for authentication and the AES-256 encrypted reversible storage for owner retrieval.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `new_password` | string | ✅ | New plain text password (minimum 6 characters) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Password updated successfully"
}
```

---

## PUT /api/hrm/users/owner/password

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Allows the owner to change their own login password by providing their current password.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `current_password` | string | ✅ | Current owner password |
| `new_password` | string | ✅ | New owner password (minimum 6 characters) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Owner password updated successfully"
}
```

---

## PUT /api/hrm/users/:id/status

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Activates or deactivates any user account. Deactivated users are immediately blocked from logging in.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `is_active` | boolean | ✅ | `true` to activate, `false` to deactivate |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "User account deactivated successfully",
  "user": {
    "id": "7607e95f-5905-4dfe-9c56-4b477019a64e",
    "name": "Alex Smith",
    "email": "alex@gmail.com",
    "role": "employee",
    "is_active": false
  }
}
```

---

## GET /api/hrm/app-updates/check

**Auth:** Public / Authenticated  
**Description:** Checks if a newer version of the mobile app is available. Compares the client's `version_code` with the current active rollout on the server.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | No | `'android'` (default) or `'ios'` |
| `version_code` | number | ✅ | Current installed integer version code (e.g. `14`) |

### Response

**Update Available — `200 OK`**
```json
{
  "success": true,
  "update_available": true,
  "is_force_update": false,
  "latest_release": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "platform": "android",
    "version_name": "1.2.0",
    "version_code": 15,
    "min_supported_version_code": 12,
    "apk_url": "https://storage.example.com/apks/attendy-v1.2.0.apk",
    "apk_size_bytes": 36500000,
    "release_notes": "• Advance salary requests and tracking\n• Real-time attendance enhancements\n• Fixes and stability improvements",
    "published_at": "2026-09-21T10:00:00.000Z"
  }
}
```

**Up-To-Date — `200 OK`**
```json
{
  "success": true,
  "update_available": false,
  "current_version_code": 15,
  "latest_version_code": 15
}
```

---

## POST /api/hrm/app-updates/publish

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Publishes a new app release. If `is_active` is true, previous releases for the platform are automatically set to inactive.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | No | `'android'` (default) or `'ios'` |
| `version_name` | string | ✅ | Semantic version string (e.g. `'1.2.0'`) |
| `version_code` | number | ✅ | Positive integer build number (e.g. `15`) |
| `apk_url` | string | ✅ | Direct download link for APK file |
| `apk_size_bytes` | number | No | File size in bytes (e.g. `36500000`) |
| `release_notes` | string | No | Changelog notes shown to the user |
| `min_supported_version_code` | number | No | Minimum build number below which update is mandatory |
| `is_force_update` | boolean | No | `true` to mandate immediate update before app use |
| `is_active` | boolean | No | `true` to immediately activate this rollout (default: `true`) |

### Response

**Success — `201 Created`**
```json
{
  "success": true,
  "message": "App release v1.2.0 (build 15) published successfully",
  "data": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "platform": "android",
    "version_name": "1.2.0",
    "version_code": 15,
    "apk_url": "https://storage.example.com/apks/attendy-v1.2.0.apk",
    "is_active": true,
    "created_at": "2026-09-21T10:00:00.000Z"
  }
}
```

---

## GET /api/hrm/app-updates/releases

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Lists all app release records with pagination, rollout status, and publisher metadata.

### Request

**Query Params**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `platform` | string | No | Filter by `'android'` or `'ios'` |
| `page` | number | No | Page number (default: `1`) |
| `limit` | number | No | Results per page (default: `20`) |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "data": [
    {
      "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      "platform": "android",
      "version_name": "1.2.0",
      "version_code": 15,
      "apk_url": "https://storage.example.com/apks/attendy-v1.2.0.apk",
      "is_active": true,
      "is_force_update": false,
      "created_at": "2026-09-21T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

---

## PUT /api/hrm/app-updates/releases/:id/rollout

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Activates, pauses, or changes force update settings for any specific release.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `is_active` | boolean | No | `true` to make this the active rollout |
| `is_force_update` | boolean | No | `true` to mandate updates |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Rollout status for v1.2.0 updated successfully",
  "data": {
    "id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "is_active": true,
    "is_force_update": false
  }
}
```

---

## DELETE /api/hrm/app-updates/releases/:id

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Deletes a release record.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Release record deleted successfully"
}
```

---

## GET /api/hrm/organization/settings/lunch-tracking

**Auth:** Authenticated (`owner`, `branch_manager`)  
**Description:** Retrieves the global organization-wide lunch break tracking setting.

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "data": {
    "enabled": true
  }
}
```

---

## PUT /api/hrm/organization/settings/lunch-tracking

**Auth:** Authenticated (`owner` ONLY)  
**Description:** Updates the global organization-wide lunch break tracking default setting.

### Request

**Body**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | ✅ | `true` to enable lunch break tracking globally by default, `false` to disable |

### Response

**Success — `200 OK`**
```json
{
  "success": true,
  "message": "Global lunch tracking settings updated successfully",
  "data": {
    "enabled": true
  }
}
```




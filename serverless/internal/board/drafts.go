package board

import "time"

// A draft (#381) is a task the app's add form attaches files to before Add, so they upload while
// the form is filled in. It is no task until it is added, and then keeps its id.
const (
	// MaxOpenDrafts is how many drafts a user may have open at once: Gunnar's choice on #434.
	MaxOpenDrafts = 5
	// DraftLifetime is how long a draft lasts unadded: as long as an announced upload, the
	// Quarkus backend's taskfest.attachments.pending-lifetime (Gunnar's decision on #381).
	DraftLifetime = time.Hour
)

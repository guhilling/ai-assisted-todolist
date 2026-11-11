package files

import (
	"sync"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
)

// tidyAbove is how many links are kept before the expired ones are first cleared out: far more
// than are in use.
const tidyAbove = 1000

// reused is the links to open files handed out again while they are fresh (#236), per object.
// The browser caches a file by its URL, and every newly signed link is a new URL, so a link is
// handed out again while at least half its lifetime is left. Each Lambda instance keeps its own;
// with several, a browser sees several URLs at worst, which costs a fetch and nothing else.
type reused struct {
	mu       sync.Mutex
	links    map[string]Link
	lifetime time.Duration
	// tidyAbove is the size at which the next clear-out happens: twice what the last one left,
	// so one that frees little is not repeated on every request.
	tidyAbove int
}

// newReused keeps links that are signed for lifetime.
func newReused(lifetime time.Duration) *reused {
	return &reused{links: map[string]Link{}, lifetime: lifetime, tidyAbove: tidyAbove}
}

// get is the link to hand out for the object now: the one already signed while half its lifetime
// is left, otherwise a newly signed one.
func (r *reused) get(key string, now time.Time, sign func() (Link, error)) (Link, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.links) > r.tidyAbove {
		r.forgetExpiredLocked(now)
		r.tidyAbove = max(tidyAbove, len(r.links)*2)
	}
	if current, ok := r.links[key]; ok && !now.After(reusableUntil(current, r.lifetime)) {
		return current, nil
	}
	link, err := sign()
	if err != nil {
		return Link{}, err
	}
	r.links[key] = link
	return link, nil
}

// forgetExpired drops the links that no longer work.
func (r *reused) forgetExpired(now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.forgetExpiredLocked(now)
}

// forgetExpiredLocked drops the links that no longer work, with the lock held.
func (r *reused) forgetExpiredLocked(now time.Time) {
	for key, link := range r.links {
		if !link.ExpiresAt.After(now) {
			delete(r.links, key)
		}
	}
}

// reusableUntil is until when a link is handed out again.
func reusableUntil(link Link, lifetime time.Duration) time.Time {
	return link.ExpiresAt.Add(-lifetime / 2)
}

// KeepFor is how long the browser may keep an answer carrying this link: until it would no longer
// be handed out, so browser and backend move to the next link at the same moment.
func KeepFor(link Link, now time.Time) time.Duration {
	return max(reusableUntil(link, board.DownloadLinkLifetime).Sub(now), 0)
}

package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/files"
)

// The Quarkus backend's AttachmentResourceTest, AttachmentThumbnailTest, LinkAttachmentTest and
// DraftTaskTest, at the HTTP layer, against an in-memory board and bucket. What S3 does with a
// signed link is internal/files' tests'; the limits under requests at once, the undo window and
// the expiry of pending uploads and of a draft's files are the store's, which internal/store's
// tests cover.

// The boards of the earlier tests hold no attachments.
func (m *memBoard) Attachments(context.Context, string, time.Time) (map[int64][]board.Attachment, error) {
	return nil, nil
}

func (f *fakeTasks) Attachments(context.Context, string, time.Time) (map[int64][]board.Attachment, error) {
	return nil, nil
}

// memAttached is a board with attachments, every user's in memory: on a task, or detached from a
// deleted one. It keeps the limits as the store does, without the expiries.
type memAttached struct {
	*memBoard
	items    map[string][]*board.Attachment
	last     map[string]int64
	detached map[string][]int64
	failing  error
	// unreadable fails reading the board's attachments.
	unreadable error
}

func newMemAttached() *memAttached {
	return &memAttached{memBoard: newMemBoard(), items: map[string][]*board.Attachment{},
		last: map[string]int64{}, detached: map[string][]int64{}}
}

func (m *memAttached) isTarget(email string, taskID int64) bool {
	_, task := m.tasks[email][taskID]
	return task || m.drafts[email][taskID]
}

func (m *memAttached) Attachments(_ context.Context, email string, _ time.Time) (map[int64][]board.Attachment, error) {
	if m.unreadable != nil {
		return nil, m.unreadable
	}
	out := map[int64][]board.Attachment{}
	for _, a := range m.items[email] {
		if a.Available && a.TaskID != 0 {
			out[a.TaskID] = append(out[a.TaskID], *a)
		}
	}
	return out, nil
}

func (m *memAttached) Attach(_ context.Context, email string, taskID int64, a board.Attachment, _ time.Time) (board.Attachment, error) {
	if !m.isTarget(email, taskID) {
		return board.Attachment{}, board.ErrNotFound
	}
	onTask := 0
	for _, it := range m.items[email] {
		if it.TaskID == taskID {
			onTask++
		}
	}
	if err := board.Admit(a, onTask, len(m.items[email])); err != nil {
		return board.Attachment{}, err
	}
	m.last[email]++
	a.ID, a.TaskID, a.Available = m.last[email], taskID, !a.Kind.IsFile()
	if a.Kind.IsFile() {
		a.ObjectKey = fmt.Sprintf("key-%d", a.ID)
	}
	m.items[email] = append(m.items[email], &a)
	return a, nil
}

func (m *memAttached) find(email string, taskID, id int64) (*board.Attachment, error) {
	for _, a := range m.items[email] {
		if a.ID == id && a.TaskID == taskID && taskID != 0 && m.isTarget(email, taskID) {
			return a, nil
		}
	}
	return nil, board.ErrNotFound
}

func (m *memAttached) Attachment(_ context.Context, email string, taskID, id int64, _ time.Time) (board.Attachment, error) {
	a, err := m.find(email, taskID, id)
	if err != nil {
		return board.Attachment{}, err
	}
	return *a, nil
}

func (m *memAttached) Confirm(_ context.Context, email string, taskID, id int64, thumbnail bool, _ time.Time) (board.Attachment, error) {
	if m.failing != nil {
		return board.Attachment{}, m.failing
	}
	a, err := m.find(email, taskID, id)
	if err != nil {
		return board.Attachment{}, err
	}
	if !a.Available {
		a.Available, a.Thumbnail = true, thumbnail
	}
	return *a, nil
}

func (m *memAttached) RemoveAttachment(_ context.Context, email string, id int64) error {
	m.items[email] = slices.DeleteFunc(m.items[email], func(a *board.Attachment) bool { return a.ID == id })
	return nil
}

func (m *memAttached) Delete(ctx context.Context, email string, id int64) (bool, error) {
	found, err := m.memBoard.Delete(ctx, email, id)
	for _, a := range m.items[email] {
		if found && a.TaskID == id {
			a.TaskID = 0
		}
	}
	return found, err
}

func (m *memAttached) Reattach(_ context.Context, email string, taskID int64, ids []int64, _ time.Time) error {
	if m.failing != nil {
		return m.failing
	}
	room := board.MaxPerTask
	for _, a := range m.items[email] {
		if a.TaskID == 0 && slices.Contains(ids, a.ID) && room > 0 {
			a.TaskID = taskID
			room--
		}
	}
	return nil
}

// memFiles is a bucket in memory: what was uploaded, by key, and what was deleted.
type memFiles struct {
	objects map[string]files.Object
	deleted []string
	// failing fails every delete.
	failing error
}

func (f *memFiles) UploadLink(_ context.Context, key, contentType string, size int64) (files.Link, error) {
	return files.Link{URL: "https://storage.example.com/" + key + "?put",
		Headers: map[string]string{"Content-Type": contentType}, ExpiresAt: noon().Add(board.UploadLinkLifetime)}, nil
}

func (f *memFiles) DownloadLink(_ context.Context, key, contentType, fileName string) (files.Link, error) {
	return files.Link{URL: "https://storage.example.com/" + key + "?get=" + fileName,
		ExpiresAt: noon().Add(board.DownloadLinkLifetime)}, nil
}

func (f *memFiles) Head(_ context.Context, key string) (files.Object, bool, error) {
	o, ok := f.objects[key]
	return o, ok, nil
}

func (f *memFiles) Delete(_ context.Context, key string) error {
	if f.failing != nil {
		return f.failing
	}
	f.deleted = append(f.deleted, key)
	delete(f.objects, key)
	return nil
}

func attachedServer(caller Caller) (*Server, *memAttached, *memFiles) {
	b, f := newMemAttached(), &memFiles{objects: map[string]files.Object{}}
	return &Server{Caller: caller, Tasks: b, Writes: b, Attachments: b, Files: f, Now: noon}, b, f
}

type uploadAnswer struct {
	Attachment      attachmentAnswer  `json:"attachment"`
	URL             string            `json:"url"`
	Headers         map[string]string `json:"headers"`
	ExpiresAt       time.Time         `json:"expiresAt"`
	ThumbnailUpload *struct {
		URL     string            `json:"url"`
		Headers map[string]string `json:"headers"`
	} `json:"thumbnailUpload"`
}

type attachmentAnswer struct {
	ID          int64   `json:"id"`
	FileName    string  `json:"fileName"`
	ContentType string  `json:"contentType"`
	SizeBytes   int64   `json:"sizeBytes"`
	Thumbnail   bool    `json:"thumbnail"`
	URL         *string `json:"url"`
}

func decodeAs[T any](t *testing.T, body []byte) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("%s: %v", body, err)
	}
	return v
}

func taskFor(t *testing.T, s *Server, description string) int64 {
	t.Helper()
	return created(t, s, taskJSON(description, "2026-11-11", "MEDIUM", "TODO")).ID
}

func announceJSON(name, contentType string, size int64, thumbnail ...int64) string {
	fields := map[string]any{"fileName": name, "contentType": contentType, "sizeBytes": size}
	if len(thumbnail) > 0 {
		fields["thumbnailSizeBytes"] = thumbnail[0]
	}
	b, _ := json.Marshal(fields)
	return string(b)
}

func attachmentsPath(taskID int64) string { return fmt.Sprintf("/api/tasks/%d/attachments", taskID) }

func attachmentPath(taskID, id int64, rest string) string {
	return fmt.Sprintf("/api/tasks/%d/attachments/%d%s", taskID, id, rest)
}

func announced(t *testing.T, s *Server, taskID int64, body string) uploadAnswer {
	t.Helper()
	rec := send(s, "POST", attachmentsPath(taskID), body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("announce: %d (%s)", rec.Code, rec.Body)
	}
	return decodeAs[uploadAnswer](t, rec.Body.Bytes())
}

// uploaded stands for the browser's PUT through the link: the object is then there.
func uploaded(f *memFiles, key, contentType string, size int64) {
	f.objects[key] = files.Object{ContentType: contentType, Size: size}
}

func refusal(t *testing.T, rec interface{ Result() *http.Response }, body []byte, want board.Refusal) {
	t.Helper()
	if code := rec.Result().StatusCode; code != http.StatusUnprocessableEntity {
		t.Fatalf("got %d (%s); want 422", code, body)
	}
	if got := decodeAs[struct{ Refusal string }](t, body).Refusal; got != string(want) {
		t.Errorf("refusal %s; want %s", got, want)
	}
}

func TestAttachmentsNeedACaller(t *testing.T) {
	s, _, _ := attachedServer(nobody)
	for _, r := range []struct{ method, path string }{
		{"POST", "/api/tasks/1/attachments"}, {"POST", "/api/tasks/1/attachments/links"},
		{"POST", "/api/tasks/1/attachments/2/confirm"}, {"GET", "/api/tasks/1/attachments/2/link"},
		{"GET", "/api/tasks/1/attachments/2/thumbnail-link"}, {"DELETE", "/api/tasks/1/attachments/2"},
	} {
		if rec := send(s, r.method, r.path, `{}`); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: %d", r.method, r.path, rec.Code)
		}
	}
}

func TestAFileIsUploadedListedOpenedAndRemoved(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Pay the invoice")

	up := announced(t, s, taskID, announceJSON("Rechnung März.pdf", "application/pdf", 30))
	if up.URL == "" || up.Headers["Content-Type"] != "application/pdf" || up.Attachment.FileName != "Rechnung März.pdf" ||
		up.Attachment.URL != nil || !up.ExpiresAt.Equal(noon().Add(board.UploadLinkLifetime)) {
		t.Fatalf("announced %+v", up)
	}
	id := up.Attachment.ID
	uploaded(f, "key-1", "application/pdf", 30)

	rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")
	if got := decodeAs[attachmentAnswer](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.FileName != "Rechnung März.pdf" {
		t.Fatalf("confirm: %d %s", rec.Code, rec.Body)
	}
	tasks := decodeAs[[]struct {
		ID          int64
		Attachments []attachmentAnswer
	}](t, get(s, "/api/tasks").Body.Bytes())
	if len(tasks) != 1 || len(tasks[0].Attachments) != 1 || tasks[0].Attachments[0].ID != id {
		t.Fatalf("board %+v", tasks)
	}

	open := send(s, "GET", attachmentPath(taskID, id, "/link"), "")
	if got := decodeAs[struct{ URL string }](t, open.Body.Bytes()); open.Code != http.StatusOK ||
		!strings.Contains(got.URL, "key-1") {
		t.Fatalf("link: %d %s", open.Code, open.Body)
	}

	if rec := send(s, "DELETE", attachmentPath(taskID, id, ""), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("remove: %d", rec.Code)
	}
	if _, there := f.objects["key-1"]; there {
		t.Error("the file stayed in storage")
	}
	if rec := send(s, "GET", attachmentPath(taskID, id, "/link"), ""); rec.Code != http.StatusNotFound {
		t.Errorf("link after remove: %d", rec.Code)
	}
}

func TestAnUploadThatHasNotArrivedIsNotConfirmed(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Wait for the scan")
	id := announced(t, s, taskID, announceJSON("scan.png", "image/png", 10)).Attachment.ID

	if rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), ""); rec.Code != http.StatusConflict {
		t.Errorf("confirm: %d", rec.Code)
	}
}

func TestAConfirmIsAnsweredTheSameWhenRetried(t *testing.T) {
	// A retried confirm, the first answer lost on the way, must not fail the upload.
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Retry the confirm")
	id := announced(t, s, taskID, announceJSON("twice.pdf", "application/pdf", 10)).Attachment.ID
	uploaded(f, "key-1", "application/pdf", 10)

	for range 2 {
		rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")
		if got := decodeAs[attachmentAnswer](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.ID != id {
			t.Fatalf("confirm: %d %s", rec.Code, rec.Body)
		}
	}
}

func TestAFileThatArrivedOtherThanAnnouncedIsDeleted(t *testing.T) {
	// The signed link makes this impossible through the front door; written straight into the
	// bucket, it stands for whatever might one day get past it.
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Check what arrived")
	id := announced(t, s, taskID, announceJSON("page.pdf", "application/pdf", 10)).Attachment.ID
	uploaded(f, "key-1", "text/html", 10)

	rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")

	refusal(t, rec, rec.Body.Bytes(), board.RefusedMismatch)
	if _, there := f.objects["key-1"]; there {
		t.Error("the file stayed")
	}
	if rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), ""); rec.Code != http.StatusNotFound {
		t.Errorf("confirm again: %d", rec.Code)
	}
}

func TestAFileOfAnotherSizeThanAnnouncedIsAMismatch(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Count the bytes")
	id := announced(t, s, taskID, announceJSON("a.pdf", "application/pdf", 10)).Attachment.ID
	uploaded(f, "key-1", "application/pdf", 11)

	rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")

	refusal(t, rec, rec.Body.Bytes(), board.RefusedMismatch)
}

func TestAConfirmThatLostItsRaceWithASweepIsNotArrived(t *testing.T) {
	// Swept between the look into storage and the write, as Quarkus answers it.
	s, b, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Too slow")
	id := announced(t, s, taskID, announceJSON("a.pdf", "application/pdf", 10)).Attachment.ID
	uploaded(f, "key-1", "application/pdf", 10)
	b.failing = board.ErrNotFound

	if rec := send(s, "POST", attachmentPath(taskID, id, "/confirm"), ""); rec.Code != http.StatusConflict {
		t.Errorf("confirm: %d", rec.Code)
	}
}

func TestNoLinkIsOfferedForAFileThatHasNotArrivedOrDoesNotExist(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Nothing to open yet")
	id := announced(t, s, taskID, announceJSON("later.png", "image/png", 10)).Attachment.ID

	for _, path := range []string{attachmentPath(taskID, id, "/link"), attachmentPath(taskID, id+1000, "/link"),
		attachmentPath(taskID, id, "/thumbnail-link")} {
		if rec := send(s, "GET", path, ""); rec.Code != http.StatusNotFound {
			t.Errorf("%s: %d", path, rec.Code)
		}
	}
}

func TestAnUnsupportedTypeAndAFileTooLargeAreRefused(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Collect the paperwork")

	for body, want := range map[string]board.Refusal{
		announceJSON("page.html", "text/html", 10): board.RefusedType,
		// A browser reports File.type as "" for an extension it does not know.
		announceJSON("notes.xyz", "", 10): board.RefusedType,
		// The link's type is no file's: announcing one would make a link with an object.
		announceJSON("links.txt", "text/uri-list", 10):              board.RefusedType,
		announceJSON("huge.pdf", "application/pdf", 10*1024*1024+1): board.RefusedTooLarge,
	} {
		rec := send(s, "POST", attachmentsPath(taskID), body)
		refusal(t, rec, rec.Body.Bytes(), want)
	}
}

func TestAThirdAttachmentOnATaskAndASixthOfAUserAreRefused(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	full := taskFor(t, s, "Two pictures at most")
	announced(t, s, full, announceJSON("one.jpg", "image/jpeg", 10))
	announced(t, s, full, announceJSON("two.jpg", "image/jpeg", 10))
	rec := send(s, "POST", attachmentsPath(full), announceJSON("three.jpg", "image/jpeg", 10))
	refusal(t, rec, rec.Body.Bytes(), board.RefusedTaskFull)

	second := taskFor(t, s, "Two more")
	announced(t, s, second, announceJSON("a.png", "image/png", 10))
	announced(t, s, second, announceJSON("b.png", "image/png", 10))
	third := taskFor(t, s, "The fifth")
	announced(t, s, third, announceJSON("c.png", "image/png", 10))
	rec = send(s, "POST", attachmentsPath(taskFor(t, s, "One too many")), announceJSON("six.png", "image/png", 10))
	refusal(t, rec, rec.Body.Bytes(), board.RefusedUserFull)
}

func TestAnAnnouncementThatIsNoneIsABadRequest(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Nothing sent")

	for _, body := range []string{"null", "", `{}`, `[]`,
		announceJSON("a.pdf", "application/pdf", 0), announceJSON(" ", "application/pdf", 10),
		`{"fileName":"a.pdf","sizeBytes":10}`, `{"fileName":"a.pdf","contentType":"application/pdf"}`,
		`{"FileName":"a.pdf","contentType":"application/pdf","sizeBytes":10}`,
		`{"fileName":"a.pdf","contentType":"application/pdf","sizeBytes":"10"}`,
		announceJSON(strings.Repeat("a", 1025), "application/pdf", 10),
		announceJSON("a.pdf", strings.Repeat("a", 256), 10),
	} {
		if rec := send(s, "POST", attachmentsPath(taskID), body); rec.Code != http.StatusBadRequest {
			t.Errorf("%.60s: %d", body, rec.Code)
		}
	}
}

func TestAnOverlongFileNameIsCutRatherThanRefused(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Long name")

	up := announced(t, s, taskID, announceJSON(strings.Repeat("a", 300)+".pdf", "application/pdf", 10))

	if up.Attachment.FileName != strings.Repeat("a", 255) {
		t.Errorf("%q", up.Attachment.FileName)
	}
}

func TestSomeoneElsesTaskAndAttachmentAreAnsweredLikeMissingOnes(t *testing.T) {
	s, b, _ := attachedServer(as(alice))
	victim, _ := b.Create(context.Background(), bob, board.Task{Description: "Private", DueDate: "2026-11-11",
		Importance: board.ImportanceLow, State: board.StateTodo})
	secret, _ := b.Attach(context.Background(), bob, victim.ID, board.Attachment{FileName: "secret.pdf",
		Kind: board.KindPDF, SizeBytes: 10}, noon())

	for _, r := range []struct{ method, path, body string }{
		{"POST", attachmentsPath(victim.ID), announceJSON("mine.pdf", "application/pdf", 10)},
		{"POST", attachmentsPath(victim.ID) + "/links", `{"url":"https://example.com"}`},
		{"GET", attachmentPath(victim.ID, secret.ID, "/link"), ""},
		{"POST", attachmentPath(victim.ID, secret.ID, "/confirm"), ""},
		{"DELETE", attachmentPath(victim.ID, secret.ID, ""), ""},
	} {
		if rec := send(s, r.method, r.path, r.body); rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: %d", r.method, r.path, rec.Code)
		}
	}
	if len(b.items[bob]) != 1 {
		t.Error("their attachment went")
	}
}

func TestADeletedTasksAttachmentsComeBackWithItsUndo(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Deleted by mistake")
	id := announced(t, s, taskID, announceJSON("plan.pdf", "application/pdf", 10)).Attachment.ID
	uploaded(f, "key-1", "application/pdf", 10)
	send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")
	if rec := send(s, "DELETE", fmt.Sprintf("/api/tasks/%d", taskID), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete: %d", rec.Code)
	}

	rec := send(s, "POST", "/api/tasks", fmt.Sprintf(
		`{"description":"Deleted by mistake","dueDate":"2026-11-11","importance":"MEDIUM","state":"TODO","attachmentIds":[%d]}`, id))

	got := decodeAs[struct{ Attachments []attachmentAnswer }](t, rec.Body.Bytes())
	if rec.Code != http.StatusCreated || len(got.Attachments) != 1 || got.Attachments[0].ID != id {
		t.Fatalf("undo: %d %s", rec.Code, rec.Body)
	}
	if _, there := f.objects["key-1"]; !there {
		t.Error("the file went with the task")
	}
}

func TestAnUndoThatCannotBringItsAttachmentsBackStillCreatesTheTask(t *testing.T) {
	// Undo is best effort: the files expire on their own, and the task is what was asked for.
	s, b, _ := attachedServer(as(alice))
	b.failing = errors.New("DynamoDB is down")

	rec := send(s, "POST", "/api/tasks",
		`{"description":"Had one","dueDate":"2026-11-11","importance":"MEDIUM","state":"TODO","attachmentIds":[1]}`)

	if got := decodeAs[struct{ Attachments []attachmentAnswer }](t, rec.Body.Bytes()); rec.Code != http.StatusCreated ||
		got.Attachments == nil || len(got.Attachments) != 0 {
		t.Errorf("%d %s", rec.Code, rec.Body)
	}
}

func TestACreatedTaskIsAnsweredWhenItsAttachmentsCannotBeRead(t *testing.T) {
	// It was written: a 500 would make the client create it again. A new task has none anyway,
	// and after an undo the next board load shows what came back.
	s, b, _ := attachedServer(as(alice))
	b.unreadable = errors.New("DynamoDB is slow")

	for _, extra := range []string{"", `,"attachmentIds":[1]`} {
		rec := send(s, "POST", "/api/tasks",
			`{"description":"New","dueDate":"2026-11-11","importance":"MEDIUM","state":"TODO"`+extra+`}`)
		if got := decodeAs[struct{ Attachments []attachmentAnswer }](t, rec.Body.Bytes()); rec.Code != http.StatusCreated ||
			got.Attachments == nil || len(got.Attachments) != 0 {
			t.Errorf("%q: %d %s", extra, rec.Code, rec.Body)
		}
	}
}

func TestAnAttachmentWhoseFilesFailToGoIsRemovedAllTheSame(t *testing.T) {
	// The item is gone, so a retry would be a 404; the table's stream deletes the files.
	s, b, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Storage is down")
	id := announced(t, s, taskID, announceJSON("a.pdf", "application/pdf", 10)).Attachment.ID
	f.failing = errors.New("S3 is down")

	if rec := send(s, "DELETE", attachmentPath(taskID, id, ""), ""); rec.Code != http.StatusNoContent {
		t.Errorf("remove: %d", rec.Code)
	}
	if len(b.items[alice]) != 0 {
		t.Error("the attachment stayed")
	}
}

func TestAnImagesThumbnailIsStoredBesideItAndOpened(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Holiday photo")

	up := announced(t, s, taskID, announceJSON("beach.jpg", "image/jpeg", 100, 5))
	if up.ThumbnailUpload == nil || !strings.Contains(up.ThumbnailUpload.URL, "key-1.thumbnail") ||
		up.ThumbnailUpload.Headers["Content-Type"] != "image/jpeg" {
		t.Fatalf("thumbnail upload %+v", up.ThumbnailUpload)
	}
	uploaded(f, "key-1", "image/jpeg", 100)
	uploaded(f, "key-1.thumbnail", "image/jpeg", 5)

	rec := send(s, "POST", attachmentPath(taskID, up.Attachment.ID, "/confirm"), "")
	if got := decodeAs[attachmentAnswer](t, rec.Body.Bytes()); !got.Thumbnail {
		t.Fatalf("confirm %s", rec.Body)
	}
	open := send(s, "GET", attachmentPath(taskID, up.Attachment.ID, "/thumbnail-link"), "")
	if got := decodeAs[struct{ URL string }](t, open.Body.Bytes()); open.Code != http.StatusOK ||
		!strings.Contains(got.URL, "key-1.thumbnail") {
		t.Errorf("thumbnail link: %d %s", open.Code, open.Body)
	}

	send(s, "DELETE", attachmentPath(taskID, up.Attachment.ID, ""), "")
	if !slices.Contains(f.deleted, "key-1.thumbnail") {
		t.Error("the thumbnail stayed")
	}
}

func TestAnImageWhoseThumbnailNeverArrivedIsConfirmedWithoutOne(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Thumbnail lost")
	up := announced(t, s, taskID, announceJSON("lost.jpg", "image/jpeg", 100, 5))
	uploaded(f, "key-1", "image/jpeg", 100)

	rec := send(s, "POST", attachmentPath(taskID, up.Attachment.ID, "/confirm"), "")

	if got := decodeAs[attachmentAnswer](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.Thumbnail {
		t.Fatalf("confirm %d %s", rec.Code, rec.Body)
	}
	if rec := send(s, "GET", attachmentPath(taskID, up.Attachment.ID, "/thumbnail-link"), ""); rec.Code != http.StatusNotFound {
		t.Errorf("thumbnail link: %d", rec.Code)
	}
}

func TestAThumbnailOfAnotherTypeIsNone(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Odd thumbnail")
	up := announced(t, s, taskID, announceJSON("a.png", "image/png", 100, 5))
	uploaded(f, "key-1", "image/png", 100)
	uploaded(f, "key-1.thumbnail", "image/png", 5)

	rec := send(s, "POST", attachmentPath(taskID, up.Attachment.ID, "/confirm"), "")

	if got := decodeAs[attachmentAnswer](t, rec.Body.Bytes()); got.Thumbnail {
		t.Errorf("confirm %s", rec.Body)
	}
}

func TestNoThumbnailIsOfferedForAPDFOneTooLargeEmptyOrNotAsked(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	for _, body := range []string{announceJSON("scan.pdf", "application/pdf", 100, 10),
		announceJSON("huge.jpg", "image/jpeg", 100, 1024*1024), announceJSON("empty.jpg", "image/jpeg", 100, 0),
		announceJSON("plain.png", "image/png", 100), `{"fileName":"n.png","contentType":"image/png","sizeBytes":1,"thumbnailSizeBytes":null}`} {
		// Each on a task of its own, for the per-task limit.
		up := announced(t, s, taskFor(t, s, "No thumbnails here"), body)
		if up.ThumbnailUpload != nil || up.Attachment.Thumbnail {
			t.Errorf("%s: %+v", body, up)
		}
	}
}

func TestTheSameLinkMayBeKeptByTheBrowserWhileItIsFresh(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Cache me")
	id := announced(t, s, taskID, announceJSON("cache.jpg", "image/jpeg", 10)).Attachment.ID
	uploaded(f, "key-1", "image/jpeg", 10)
	send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")

	rec := send(s, "GET", attachmentPath(taskID, id, "/link"), "")

	// As JAX-RS writes a CacheControl: half the hour is left, which is how long it is handed out.
	if got := rec.Header().Get("Cache-Control"); got != "private, no-transform, max-age=1800" {
		t.Errorf("Cache-Control %q", got)
	}
}

// LinkAttachmentTest.

const article = "https://example.com/articles/42?ref=share"

func linkJSON(url string, title ...string) string {
	fields := map[string]any{"url": url}
	if len(title) > 0 {
		fields["title"] = title[0]
	}
	b, _ := json.Marshal(fields)
	return string(b)
}

func addedLink(t *testing.T, s *Server, taskID int64, body string) attachmentAnswer {
	t.Helper()
	rec := send(s, "POST", attachmentsPath(taskID)+"/links", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("add link: %d (%s)", rec.Code, rec.Body)
	}
	return decodeAs[attachmentAnswer](t, rec.Body.Bytes())
}

func TestALinkIsAddedAndListedWithItsTitle(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Read later")

	got := addedLink(t, s, taskID, linkJSON(article, "An article worth reading"))

	if got.FileName != "An article worth reading" || got.ContentType != "text/uri-list" || str(got.URL) != article ||
		got.Thumbnail || got.SizeBytes != 0 {
		t.Errorf("%+v", got)
	}
	board := decodeAs[[]struct{ Attachments []attachmentAnswer }](t, get(s, "/api/tasks").Body.Bytes())
	if len(board) != 1 || len(board[0].Attachments) != 1 || str(board[0].Attachments[0].URL) != article {
		t.Errorf("board %+v", board)
	}
}

func TestALinkWithoutATitleIsNamedByItsURLAndATitleKeptOnOneLine(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Untitled")

	if got := addedLink(t, s, taskID, linkJSON(article)); got.FileName != article {
		t.Errorf("%q", got.FileName)
	}
	if got := addedLink(t, s, taskID, linkJSON(article, "  Breaking:\nnews  ")); got.FileName != "Breaking: news" {
		t.Errorf("%q", got.FileName)
	}
}

func TestOnlyAWebAddressIsTakenForALink(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Only the web")

	for _, body := range []string{linkJSON("javascript:alert(1)", "Nope"), linkJSON("data:text/html,hi"),
		linkJSON("ftp://example.com/x"), linkJSON("https://"), linkJSON("https://example.com/with space"),
		linkJSON("https://example.com:bad/path"), linkJSON(""), "null", `{}`, `{"url":5}`,
		linkJSON(article, strings.Repeat("t", 1025))} {
		if rec := send(s, "POST", attachmentsPath(taskID)+"/links", body); rec.Code != http.StatusBadRequest {
			t.Errorf("%.60s: %d", body, rec.Code)
		}
	}
}

func TestLinksCountWithFilesAgainstTheTasksLimit(t *testing.T) {
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "A file and a link")
	announced(t, s, taskID, announceJSON("a.pdf", "application/pdf", 10))
	addedLink(t, s, taskID, linkJSON(article, "One"))

	rec := send(s, "POST", attachmentsPath(taskID)+"/links", linkJSON(article, "Two"))

	refusal(t, rec, rec.Body.Bytes(), board.RefusedTaskFull)
}

func TestALinksOwnAddressIsItsLink(t *testing.T) {
	// Its URL is the way to open it. An app from before links (#268) asks for one all the same.
	s, _, _ := attachedServer(as(alice))
	taskID := taskFor(t, s, "Open by URL")
	id := addedLink(t, s, taskID, linkJSON(article, "Opened directly")).ID

	rec := send(s, "GET", attachmentPath(taskID, id, "/link"), "")
	if got := decodeAs[struct {
		URL       string
		ExpiresAt time.Time
	}](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.URL != article ||
		!got.ExpiresAt.Equal(noon().Add(board.DownloadLinkLifetime)) {
		t.Errorf("link: %d %s", rec.Code, rec.Body)
	}
	if rec := send(s, "GET", attachmentPath(taskID, id, "/thumbnail-link"), ""); rec.Code != http.StatusNotFound {
		t.Errorf("thumbnail link: %d", rec.Code)
	}
	rec = send(s, "POST", attachmentPath(taskID, id, "/confirm"), "")
	if got := decodeAs[attachmentAnswer](t, rec.Body.Bytes()); rec.Code != http.StatusOK || str(got.URL) != article {
		t.Errorf("confirm: %d %s", rec.Code, rec.Body)
	}
}

func TestALinkIsRemovedWithNothingInStorage(t *testing.T) {
	s, b, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Remove the link")
	id := addedLink(t, s, taskID, linkJSON(article)).ID

	if rec := send(s, "DELETE", attachmentPath(taskID, id, ""), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("remove: %d", rec.Code)
	}
	if len(b.items[alice]) != 0 || len(f.deleted) != 0 {
		t.Errorf("items %v, deleted %v", b.items[alice], f.deleted)
	}
}

// DraftTaskTest.

func TestADraftIsAddedWithTheFilesUploadedToIt(t *testing.T) {
	s, _, f := attachedServer(as(alice))
	draft := startedDraft(t, s)
	id := announced(t, s, draft, announceJSON("Scan.pdf", "application/pdf", 10)).Attachment.ID
	uploaded(f, "key-1", "application/pdf", 10)
	send(s, "POST", attachmentPath(draft, id, "/confirm"), "")

	for range 2 { // and again, as a retry whose answer was lost does (#427)
		rec := send(s, "POST", addPath(draft), taskJSON("File the scan", "2026-11-11", "MEDIUM", "TODO"))
		got := decodeAs[struct {
			ID          int64
			Attachments []attachmentAnswer
		}](t, rec.Body.Bytes())
		if rec.Code != http.StatusCreated || got.ID != draft || len(got.Attachments) != 1 || got.Attachments[0].ID != id {
			t.Fatalf("add: %d %s", rec.Code, rec.Body)
		}
	}
}

func TestTheAttachmentsMatchTheContract(t *testing.T) {
	c := loadContract(t)
	s, _, f := attachedServer(as(alice))
	taskID := taskFor(t, s, "Checked")
	check := func(method, path, body, contractPath string, status int) {
		t.Helper()
		rec := send(s, method, path, body)
		if rec.Code != status {
			t.Fatalf("%s %s: %d (%s)", method, path, rec.Code, rec.Body)
		}
		c.checkResponse(t, method, contractPath, rec.Code, rec.Body.Bytes())
	}
	const one = "/api/tasks/{taskId}/attachments/{id}"
	check("POST", attachmentsPath(taskID), announceJSON("a.jpg", "image/jpeg", 10, 5),
		"/api/tasks/{taskId}/attachments", http.StatusCreated)
	check("POST", attachmentsPath(taskID), announceJSON("a.html", "text/html", 10),
		"/api/tasks/{taskId}/attachments", http.StatusUnprocessableEntity)
	uploaded(f, "key-1", "image/jpeg", 10)
	check("POST", attachmentPath(taskID, 1, "/confirm"), "", one+"/confirm", http.StatusOK)
	check("GET", attachmentPath(taskID, 1, "/link"), "", one+"/link", http.StatusOK)
	check("POST", attachmentsPath(taskID)+"/links", linkJSON(article, "A link"),
		"/api/tasks/{taskId}/attachments/links", http.StatusCreated)
	check("GET", "/api/tasks", "", "/api/tasks", http.StatusOK)
	other := taskFor(t, s, "Mismatched")
	announced(t, s, other, announceJSON("b.pdf", "application/pdf", 10))
	uploaded(f, "key-3", "text/html", 10)
	check("POST", attachmentPath(other, 3, "/confirm"), "", one+"/confirm", http.StatusUnprocessableEntity)
}

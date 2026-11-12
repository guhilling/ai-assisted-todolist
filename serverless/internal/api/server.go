package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/guhilling/ai-assisted-todolist/serverless/internal/auth"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/board"
	"github.com/guhilling/ai-assisted-todolist/serverless/internal/identity"
)

// TasksSource is where the handlers get a user's tasks from: the DynamoDB store, or a test's.
type TasksSource interface {
	Tasks(ctx context.Context, email string) ([]board.Task, error)
	// Attachments is the available attachments on each of the user's tasks, by task id.
	Attachments(ctx context.Context, email string, now time.Time) (map[int64][]board.Attachment, error)
}

// Caller says who sent a request: the verified email that identifies them, or ok false when
// nobody is signed in. cmd/api takes it from sign-in (internal/auth).
type Caller func(r *http.Request) (email string, ok bool)

// SignIn is sign-in as the routes need it: internal/auth's Service, or a test's.
type SignIn interface {
	Identify(r *http.Request) (identity.Identity, bool)
	WithPicture(ctx context.Context, id identity.Identity) identity.Identity
	Login(w http.ResponseWriter, r *http.Request, provider string)
	Callback(w http.ResponseWriter, r *http.Request, provider string)
	Logout(w http.ResponseWriter, r *http.Request)
	// EndSession ends this browser's session and writes nothing else.
	EndSession(w http.ResponseWriter, r *http.Request)
	Config() auth.Config
}

// Server implements every route of the contract.
type Server struct {
	Tasks TasksSource
	// Writes is where creates, replaces and deletes of tasks go.
	Writes TaskWrites
	// Attachments is where a task's files and links are kept (#552), Files where a file's
	// content is.
	Attachments AttachmentWrites
	Files       FileStore
	// Accounts is where an account is deleted (#553), Records where its deletion is recorded;
	// nil where there is no bucket, and then an account is deleted without a record.
	Accounts AccountDeletion
	Records  DeletionRecords
	Caller   Caller
	SignIn   SignIn
	// Now is the clock a new task's due date is judged by; time.Now when nil.
	Now func() time.Time
	// Version is the release this build was made as, MinimumAppVersion the oldest app it serves.
	Version, MinimumAppVersion string
}

// Routes returns the routes of the contract, served by s, and the sign-in callbacks, which the
// contract leaves out because only a provider calls them.
func Routes(s *Server) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+auth.MainCallbackPath, func(w http.ResponseWriter, r *http.Request) {
		s.SignIn.Callback(w, r, "")
	})
	mux.HandleFunc("GET "+auth.MainCallbackPath+"/{provider}", func(w http.ResponseWriter, r *http.Request) {
		s.SignIn.Callback(w, r, r.PathValue("provider"))
	})
	mux.Handle("/", HandlerWithOptions(s, StdHTTPServerOptions{
		ErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, _ error) {
			// A path id that is no number: no such resource, which is what JAX-RS answers too,
			// and the only answer the contract declares for it. To a caller nobody signed in,
			// 401 first, as @Authenticated answers before the path is read.
			if _, ok := s.Caller(r); !ok {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		},
	}))
	return mux
}

// GetApiAuthProviders lists the deployment's sign-in providers, usable or not.
func (s *Server) GetApiAuthProviders(w http.ResponseWriter, r *http.Request) {
	cfg := s.SignIn.Config()
	providers := make([]AuthProviderResponse, 0, len(cfg.Providers))
	for _, p := range cfg.List() {
		var login *string
		if p.LoginURL != "" {
			login = &p.LoginURL
		}
		providers = append(providers, AuthProviderResponse{Id: p.ID, Label: p.Label, Issuer: p.Issuer,
			Available: p.Available, LoginUrl: login})
	}
	writeJSON(r.Context(), w, http.StatusOK, AuthProvidersResponse{Enabled: cfg.Enabled, Providers: providers})
}

// GetApiAuthMe answers who is signed in: the email, and the name and picture if there are any.
func (s *Server) GetApiAuthMe(w http.ResponseWriter, r *http.Request) {
	id, ok := s.SignIn.Identify(r)
	if ok && s.Accounts != nil {
		// As every other route's caller (Settled), so a session a deletion ended shows signed out.
		switch settle(r, s.Accounts, id.Email) {
		case refuse:
			ok = false
		case identifyAgain:
			id, ok = s.SignIn.Identify(r)
		}
	}
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	id = s.SignIn.WithPicture(r.Context(), id)
	writeJSON(r.Context(), w, http.StatusOK, CurrentUserResponse{
		Email: openapi_types.Email(id.Email), Name: orNull(id.Name), PictureUrl: orNull(id.Picture),
	})
}

// GetApiAuthLogin starts sign-in with the main provider.
func (s *Server) GetApiAuthLogin(w http.ResponseWriter, r *http.Request) {
	s.SignIn.Login(w, r, "")
}

// GetApiAuthLoginProvider starts sign-in with one of the further providers.
func (s *Server) GetApiAuthLoginProvider(w http.ResponseWriter, r *http.Request, provider string) {
	s.SignIn.Login(w, r, provider)
}

// GetApiAuthLogout ends the session.
func (s *Server) GetApiAuthLogout(w http.ResponseWriter, r *http.Request) {
	s.SignIn.Logout(w, r)
}

// orNull is a string the wire sends as null when it is empty.
func orNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// GetApiTasks answers the board: the caller's tasks in board order.
func (s *Server) GetApiTasks(w http.ResponseWriter, r *http.Request) {
	email, ok := s.Caller(r)
	if !ok {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	tasks, err := s.Tasks.Tasks(r.Context(), email)
	var attached map[int64][]board.Attachment
	if err == nil {
		attached, err = s.Tasks.Attachments(r.Context(), email, s.now())
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "reading the board failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	board.Sort(tasks)

	out := make([]TaskResponse, 0, len(tasks))
	for _, t := range tasks {
		response, err := taskResponse(t, attached[t.ID])
		if err != nil {
			// Only the backend writes tasks, so this is a bug or a hand-edited item: logged, and
			// left off the board rather than taking the caller's other tasks with it.
			slog.ErrorContext(r.Context(), "a stored task does not read", "task", t.ID, "error", err)
			continue
		}
		out = append(out, response)
	}
	writeJSON(r.Context(), w, http.StatusOK, out)
}

// taskResponse is a task as the contract sends it, with its due moment worked out and its
// available attachments, oldest first.
func taskResponse(t board.Task, attached []board.Attachment) (TaskResponse, error) {
	due, err := time.Parse(time.DateOnly, t.DueDate)
	if err != nil {
		return TaskResponse{}, err
	}
	at, err := board.DueAt(t)
	if err != nil {
		// As the spike: a zone the binary no longer knows leaves the moment out, not the task.
		slog.Error("a stored due time does not parse", "task", t.ID, "error", err)
	}
	attachments := make([]AttachmentResponse, 0, len(attached))
	for _, a := range attached {
		attachments = append(attachments, attachmentResponse(a))
	}
	return TaskResponse{
		Id: t.ID, Description: t.Description, DueDate: openapi_types.Date{Time: due},
		DueTime: t.DueTime, TimeZone: t.TimeZone, DueAt: at,
		Importance: TaskImportance(t.Importance), State: TaskState(t.State),
		Attachments: &attachments,
	}, nil
}

// writeJSON answers with v as JSON, or 500 when it does not marshal.
func writeJSON(ctx context.Context, w http.ResponseWriter, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		slog.ErrorContext(ctx, "writing a response failed", "error", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

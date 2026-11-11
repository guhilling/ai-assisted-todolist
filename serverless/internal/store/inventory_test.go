package store

import (
	"context"
	"slices"
	"testing"
	"time"
)

func TestTheInventoryHoldsEveryUsersAttachmentsAndNothingElse(t *testing.T) {
	client, table := localTable(t)
	w, inv := NewWrites(client, table), NewInventory(client, table)
	ctx := context.Background()
	mine, _ := w.Create(ctx, one, newTask("Mine"))
	theirs, _ := w.Create(ctx, two, newTask("Theirs"))
	file := attach(t, w, one, mine.ID, pdfFile("a.pdf"), started)
	if _, err := w.Confirm(ctx, one, mine.ID, file.ID, false, started); err != nil {
		t.Fatal(err)
	}
	pending := attach(t, w, two, theirs.ID, pdfFile("b.pdf"), started)
	attach(t, w, two, theirs.ID, link("A link"), started)
	startDraft(t, w, one, started)

	rows, err := inv.FileRows(ctx)

	if err != nil {
		t.Fatal(err)
	}
	slices.SortFunc(rows, func(a, b FileRow) int { return len(a.ObjectKey) - len(b.ObjectKey) })
	if len(rows) != 3 || rows[0].ObjectKey != "" || rows[0].Owner != OwnerKey(two) {
		t.Fatalf("rows %+v", rows)
	}
	for _, r := range rows[1:] {
		want := map[string]FileRow{file.ObjectKey: {Owner: OwnerKey(one), ID: file.ID, ObjectKey: file.ObjectKey, Available: true},
			pending.ObjectKey: {Owner: OwnerKey(two), ID: pending.ID, ObjectKey: pending.ObjectKey}}[r.ObjectKey]
		if r != want {
			t.Errorf("%+v; want %+v", r, want)
		}
	}
}

func TestAnAttachmentIsStillAvailableOnlyWhileItIsThereAvailableAndLive(t *testing.T) {
	client, table := localTable(t)
	w, inv := NewWrites(client, table), NewInventory(client, table)
	ctx := context.Background()
	task, _ := w.Create(ctx, one, newTask("Checked again"))
	file := attach(t, w, one, task.ID, pdfFile("a.pdf"), started)
	row := FileRow{Owner: OwnerKey(one), ID: file.ID, ObjectKey: file.ObjectKey}

	if ok, err := inv.StillAvailable(ctx, row, started); ok || err != nil {
		t.Errorf("pending: %v, %v", ok, err)
	}
	_, _ = w.Confirm(ctx, one, task.ID, file.ID, false, started)
	if ok, err := inv.StillAvailable(ctx, row, started); !ok || err != nil {
		t.Errorf("available: %v, %v", ok, err)
	}
	w.clock = func() time.Time { return started }
	_, _ = w.Delete(ctx, one, task.ID)
	if ok, _ := inv.StillAvailable(ctx, row, started.Add(time.Hour)); ok {
		t.Error("past the undo window")
	}
	_ = w.RemoveAttachment(ctx, one, file.ID)
	if ok, _ := inv.StillAvailable(ctx, row, started); ok {
		t.Error("removed")
	}
}

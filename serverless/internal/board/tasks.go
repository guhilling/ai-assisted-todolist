package board

import "errors"

// MaxTasksPerUser is how many tasks one user may have: Gunnar's choice on #607, for the website
// open to everyone. Drafts and attachments had limits of their own (MaxOpenDrafts, MaxPerUser);
// tasks had none, and one account could grow the table at will. Far above what a person keeps.
const MaxTasksPerUser = 500

// ErrTooManyTasks is a create, or a draft added, refused because the user has MaxTasksPerUser
// tasks already: understood and refused, as a draft beyond its limit is, not a failure.
var ErrTooManyTasks = errors.New("the user has the most tasks they may have")

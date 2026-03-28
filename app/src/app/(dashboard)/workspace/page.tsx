// Copyright (c) 2026 Zack Schwenk
// SPDX-License-Identifier: MIT

// Workspace has been replaced by the Agents screen.
// Redirect permanently to /agents?tab=workspace to preserve muscle memory.

import { permanentRedirect } from 'next/navigation';

export default function WorkspacePage(): never {
  permanentRedirect('/agents?tab=workspace');
}

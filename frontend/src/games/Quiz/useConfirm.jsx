import React, { useState } from 'react';
import { ConfirmDialog } from './QuizShared';

/** `{ request(config), dialog }`: one ConfirmDialog driven by state. */
export function useConfirm() {
  const [pending, setPending] = useState(null);
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.title ?? ''}
      text={pending?.text ?? ''}
      confirmLabel={pending?.confirmLabel}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const action = pending?.onConfirm;
        setPending(null);
        action?.();
      }}
    />
  );
  return { request: setPending, dialog };
}

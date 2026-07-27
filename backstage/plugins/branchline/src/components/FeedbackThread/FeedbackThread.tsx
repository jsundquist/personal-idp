import { useApi } from '@backstage/frontend-plugin-api';
import { parseEntityRef } from '@backstage/catalog-model';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import type { FeedbackItem, FeedbackStatus } from '../../types';

interface FeedbackThreadProps {
  instanceId: string;
  taskId: string;
  /** Owning team — may add feedback, resolve, and grant exceptions */
  canManage: boolean;
  /** Called with the number of open items after each load/mutation */
  onOpenCountChange?: (open: number) => void;
  /** Called after any mutation so the parent can refresh task counts */
  onChange?: () => void;
}

const STATUS_COLOR: Record<FeedbackStatus, 'warning' | 'success' | 'default'> = {
  open: 'warning',
  resolved: 'success',
  exception: 'default',
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  exception: 'Exception',
};

function refName(ref: string): string {
  try {
    return parseEntityRef(ref).name;
  } catch {
    return ref;
  }
}

function FeedbackCard({
  item,
  instanceId,
  canManage,
  onMutated,
}: {
  item: FeedbackItem;
  instanceId: string;
  canManage: boolean;
  onMutated: () => void;
}) {
  const api = useApi(branchlineApiRef);
  const [comment, setComment] = useState('');
  const [exceptionMode, setExceptionMode] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [busy, setBusy] = useState(false);

  const isOpen = item.status === 'open';

  const submitComment = async () => {
    if (!comment.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.addFeedbackComment(instanceId, item.id, comment.trim());
      setComment('');
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const resolve = async () => {
    setBusy(true);
    try {
      await api.closeFeedback(instanceId, item.id, 'resolved');
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  const grantException = async () => {
    if (!exceptionReason.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.closeFeedback(instanceId, item.id, 'exception', exceptionReason.trim());
      setExceptionMode(false);
      setExceptionReason('');
      onMutated();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        mb: 1.5,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
        <Chip
          size="small"
          label={STATUS_LABEL[item.status]}
          color={STATUS_COLOR[item.status]}
          variant={item.status === 'exception' ? 'outlined' : 'filled'}
        />
        <Typography variant="caption" color="text.secondary">
          {refName(item.author)}
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1 }}>
        {item.body}
      </Typography>

      {!isOpen && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {item.status === 'resolved' ? 'Resolved' : 'Exception granted'}
          {item.closedBy ? ` by ${refName(item.closedBy)}` : ''}
          {item.status === 'exception' && item.exceptionReason
            ? ` — ${item.exceptionReason}`
            : ''}
        </Typography>
      )}

      {item.comments.length > 0 && (
        <Stack spacing={0.75} sx={{ pl: 1, borderLeft: '2px solid', borderColor: 'divider', mb: 1 }}>
          {item.comments.map(c => (
            <Box key={c.id}>
              <Typography variant="caption" color="text.secondary">
                {refName(c.author)}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {c.body}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}

      {/* Comment box — available to any participant */}
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          size="small"
          fullWidth
          placeholder="Add a comment…"
          value={comment}
          onChange={e => setComment(e.target.value)}
          disabled={busy}
        />
        <Button size="small" onClick={submitComment} disabled={busy || !comment.trim()}>
          Comment
        </Button>
      </Stack>

      {/* Close actions — owning team only, open items only */}
      {canManage && isOpen && !exceptionMode && (
        <Stack direction="row" spacing={1} mt={1}>
          <Button size="small" variant="contained" color="success" onClick={resolve} disabled={busy}>
            Resolve
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setExceptionMode(true)}
            disabled={busy}
          >
            Grant Exception
          </Button>
        </Stack>
      )}
      {canManage && isOpen && exceptionMode && (
        <Box mt={1}>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={2}
            label="Reason for exception"
            value={exceptionReason}
            onChange={e => setExceptionReason(e.target.value)}
            helperText="Required — explain why this feedback is being waived."
            disabled={busy}
          />
          <Stack direction="row" spacing={1} mt={1}>
            <Button size="small" onClick={() => setExceptionMode(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={grantException}
              disabled={busy || !exceptionReason.trim()}
            >
              Confirm Exception
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

export function FeedbackThread({
  instanceId,
  taskId,
  canManage,
  onOpenCountChange,
  onChange,
}: FeedbackThreadProps) {
  const api = useApi(branchlineApiRef);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newBody, setNewBody] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.listTaskFeedback(instanceId, taskId);
      setItems(res.items);
      onOpenCountChange?.(res.counts.open);
    } finally {
      setLoading(false);
    }
  }, [api, instanceId, taskId, onOpenCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const handleMutated = async () => {
    await load();
    onChange?.();
  };

  const submitNew = async () => {
    if (!newBody.trim()) {
      return;
    }
    setBusy(true);
    try {
      await api.addFeedback(instanceId, taskId, newBody.trim());
      setNewBody('');
      setAdding(false);
      await handleMutated();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="subtitle2" fontWeight={700}>
          Feedback
        </Typography>
        {canManage && !adding && (
          <Button size="small" onClick={() => setAdding(true)}>
            Add feedback
          </Button>
        )}
      </Stack>

      {canManage && adding && (
        <Box mb={1.5}>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={2}
            label="What needs to be done?"
            value={newBody}
            onChange={e => setNewBody(e.target.value)}
            disabled={busy}
          />
          <Stack direction="row" spacing={1} mt={1}>
            <Button size="small" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={submitNew}
              disabled={busy || !newBody.trim()}
            >
              Log feedback
            </Button>
          </Stack>
        </Box>
      )}

      {items.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          No feedback logged for this step.
        </Typography>
      ) : (
        <>
          <Divider sx={{ mb: 1.5 }} />
          {items.map(item => (
            <FeedbackCard
              key={item.id}
              item={item}
              instanceId={instanceId}
              canManage={canManage}
              onMutated={handleMutated}
            />
          ))}
        </>
      )}
    </Box>
  );
}

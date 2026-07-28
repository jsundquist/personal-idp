import { useApi } from '@backstage/frontend-plugin-api';
import FeedbackOutlinedIcon from '@mui/icons-material/FeedbackOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import type { FeedbackCounts, FeedbackItem } from '../../types';
import { FeedbackDialog, type FeedbackView } from './FeedbackDialog';

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

export function FeedbackThread({
  instanceId,
  taskId,
  canManage,
  onOpenCountChange,
  onChange,
}: FeedbackThreadProps) {
  const api = useApi(branchlineApiRef);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [counts, setCounts] = useState<FeedbackCounts>({ open: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogView, setDialogView] = useState<FeedbackView>('list');

  const load = useCallback(async () => {
    try {
      const res = await api.listTaskFeedback(instanceId, taskId);
      setItems(res.items);
      setCounts(res.counts);
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

  const openDialog = (view: FeedbackView) => {
    setDialogView(view);
    setDialogOpen(true);
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
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Typography variant="subtitle2" fontWeight={700}>
          Feedback
        </Typography>
        {canManage && (
          <Button size="small" onClick={() => openDialog('add')}>
            Add feedback
          </Button>
        )}
      </Stack>

      <Box mt={1}>
        {counts.total === 0 ? (
          <Typography variant="caption" color="text.secondary">
            No feedback logged for this step.
          </Typography>
        ) : (
          <Button
            fullWidth
            variant="outlined"
            startIcon={<FeedbackOutlinedIcon />}
            onClick={() => openDialog('list')}
            sx={{ justifyContent: 'space-between', textTransform: 'none' }}
            endIcon={
              <Chip
                size="small"
                color={counts.open > 0 ? 'warning' : 'success'}
                variant="outlined"
                label={
                  counts.open > 0
                    ? `${counts.open} of ${counts.total} open`
                    : `${counts.total} resolved`
                }
              />
            }
          >
            View feedback
          </Button>
        )}
      </Box>

      <FeedbackDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        instanceId={instanceId}
        taskId={taskId}
        items={items}
        loading={loading}
        canManage={canManage}
        initialView={dialogView}
        onMutated={handleMutated}
      />
    </Box>
  );
}

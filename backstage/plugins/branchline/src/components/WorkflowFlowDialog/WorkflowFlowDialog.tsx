import { useApi } from '@backstage/frontend-plugin-api';
import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import { WorkflowFlowGraph } from '../WorkflowFlowGraph';
import type { FlowGraph, WorkflowInstance } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  workflow: WorkflowInstance;
}

export function WorkflowFlowDialog({ open, onClose, workflow }: Props) {
  const api = useApi(branchlineApiRef);
  const [graph, setGraph] = useState<FlowGraph | undefined>(workflow.flowGraph);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (workflow.flowGraph) {
      setGraph(workflow.flowGraph);
      return;
    }
    setLoading(true);
    api
      .getWorkflowInstance(workflow.id)
      .then(w => setGraph(w.flowGraph))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeCount = graph?.nodes.filter(n => n.type === 'task').length ?? 0;
  const phaseCount = graph?.nodes.filter(n => n.type === 'phase').length ?? 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { maxHeight: '92vh', height: '92vh' } }}
    >
      <DialogTitle sx={{ pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Workflow Flow
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {workflow.title}
              {phaseCount > 0 && ` · ${phaseCount} phase${phaseCount !== 1 ? 's' : ''}`}
              {nodeCount > 0 && ` · ${nodeCount} task${nodeCount !== 1 ? 's' : ''}`}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small" sx={{ mt: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress />
          </Box>
        )}
        {!loading && !graph && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <Typography color="text.secondary">No flow data available yet.</Typography>
          </Box>
        )}
        {!loading && graph && (
          <WorkflowFlowGraph graph={graph} height="100%" />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

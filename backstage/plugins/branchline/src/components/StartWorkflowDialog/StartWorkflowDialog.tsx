import { useApi } from '@backstage/frontend-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { useEffect, useState } from 'react';
import { branchlineApiRef } from '../../api/BranchlineApi';
import type { WorkflowDefinition, StartWorkflowRequest } from '../../types';

interface StartWorkflowDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (instanceId: string) => void;
}

interface FormState {
  definitionId: string;
  title: string;
  description: string;
  owningGroup: string;
  entityRef: string;
}

const emptyForm: FormState = {
  definitionId: '',
  title: '',
  description: '',
  owningGroup: '',
  entityRef: '',
};

export function StartWorkflowDialog({ open, onClose, onCreated }: StartWorkflowDialogProps) {
  const branchlineApi = useApi(branchlineApiRef);
  const catalogApi = useApi(catalogApiRef);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [groups, setGroups] = useState<Array<{ ref: string; name: string }>>([]);
  const [entities, setEntities] = useState<Array<{ ref: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(emptyForm);
    setErrors({});
    setSubmitError('');

    branchlineApi.getWorkflowDefinitions().then(setDefinitions).catch(() => setDefinitions([]));

    catalogApi
      .getEntities({ filter: { kind: 'Group' } })
      .then(res =>
        setGroups(
          res.items.map(e => ({
            ref: `group:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`,
            name: (e.spec?.profile as { displayName?: string } | undefined)?.displayName ?? e.metadata.name,
          })),
        ),
      )
      .catch(() => setGroups([]));

    catalogApi
      .getEntities({ filter: [{ kind: 'Component' }, { kind: 'API' }, { kind: 'Resource' }] })
      .then(res =>
        setEntities(
          res.items.map(e => ({
            ref: `${(e.kind ?? 'component').toLowerCase()}:${e.metadata.namespace ?? 'default'}/${e.metadata.name}`,
            name: e.metadata.title ?? e.metadata.name,
          })),
        ),
      )
      .catch(() => setEntities([]));
  }, [open, branchlineApi, catalogApi]);

  const set = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | { value: unknown }>) => {
    setForm(prev => ({ ...prev, [field]: (e.target as HTMLInputElement).value as string }));
    setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  const validate = (): boolean => {
    const newErrors: Partial<FormState> = {};
    if (!form.definitionId) newErrors.definitionId = 'Required';
    if (!form.title.trim()) newErrors.title = 'Required';
    if (!form.owningGroup) newErrors.owningGroup = 'Required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    setSubmitError('');
    try {
      const req: StartWorkflowRequest = {
        definitionId: form.definitionId,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        owningGroup: form.owningGroup,
        entityRef: form.entityRef || undefined,
      };
      const instance = await branchlineApi.startWorkflow(req);
      onCreated(instance.id);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Start New Workflow</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {submitError && <Alert severity="error">{submitError}</Alert>}

          <FormControl fullWidth error={Boolean(errors.definitionId)}>
            <InputLabel id="definition-label">Workflow Template *</InputLabel>
            <Select
              labelId="definition-label"
              value={form.definitionId}
              label="Workflow Template *"
              onChange={e => setForm(p => ({ ...p, definitionId: String(e.target.value) })) as unknown as React.ChangeEventHandler}
            >
              {definitions.map(d => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name} (v{d.version})
                </MenuItem>
              ))}
            </Select>
            {errors.definitionId && <FormHelperText>{errors.definitionId}</FormHelperText>}
          </FormControl>

          <TextField
            label="Title"
            required
            fullWidth
            value={form.title}
            onChange={set('title')}
            error={Boolean(errors.title)}
            helperText={errors.title}
          />

          <TextField
            label="Description"
            fullWidth
            multiline
            rows={3}
            value={form.description}
            onChange={set('description')}
            helperText="Supports markdown formatting"
          />

          <FormControl fullWidth error={Boolean(errors.owningGroup)}>
            <InputLabel id="group-label">Owning Group *</InputLabel>
            <Select
              labelId="group-label"
              value={form.owningGroup}
              label="Owning Group *"
              onChange={e => setForm(p => ({ ...p, owningGroup: e.target.value })) as unknown as React.ChangeEventHandler}
            >
              {groups.map(g => (
                <MenuItem key={g.ref} value={g.ref}>
                  {g.name}
                </MenuItem>
              ))}
            </Select>
            {errors.owningGroup && <FormHelperText>{errors.owningGroup}</FormHelperText>}
          </FormControl>

          <FormControl fullWidth>
            <InputLabel id="entity-label">Associated Entity (optional)</InputLabel>
            <Select
              labelId="entity-label"
              value={form.entityRef}
              label="Associated Entity (optional)"
              onChange={e => setForm(p => ({ ...p, entityRef: e.target.value })) as unknown as React.ChangeEventHandler}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {entities.map(e => (
                <MenuItem key={e.ref} value={e.ref}>
                  {e.name} ({e.ref.split(':')[0]})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : undefined}
        >
          Start Workflow
        </Button>
      </DialogActions>
    </Dialog>
  );
}

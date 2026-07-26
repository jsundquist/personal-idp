import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../StatusBadge';
import type { WorkflowInstance } from '../../types';

interface WorkflowCardProps {
  workflow: WorkflowInstance;
}

export function WorkflowCard({ workflow }: WorkflowCardProps) {
  const navigate = useNavigate();

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea
        onClick={() => navigate(`/branchline/${workflow.id}`)}
        sx={{ height: '100%', alignItems: 'flex-start' }}
      >
        <CardContent>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              mb: 1,
            }}
          >
            <Typography variant="h6" component="div" sx={{ flex: 1, pr: 1 }}>
              {workflow.title}
            </Typography>
            <StatusBadge status={workflow.status} />
          </Box>

          {workflow.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {workflow.description.length > 120
                ? `${workflow.description.slice(0, 120)}…`
                : workflow.description}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            <Chip
              label={`Owner: ${workflow.owningGroup.split('/').pop()}`}
              size="small"
              variant="outlined"
            />
            {workflow.entityRef && (
              <Chip
                label={workflow.entityRef.split('/').pop()}
                size="small"
                variant="outlined"
                color="primary"
              />
            )}
          </Box>

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: 'block' }}
          >
            Started {new Date(workflow.createdAt).toLocaleDateString()}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

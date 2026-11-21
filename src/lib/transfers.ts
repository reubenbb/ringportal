export const TRANSFER_STATUS = ['pending', 'approved', 'declined', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUS)[number];

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  pending: 'Waiting for decision',
  approved: 'Transferred',
  declined: 'Declined',
  cancelled: 'Cancelled',
};

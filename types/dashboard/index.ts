export type messageData = {
  createdAt: string;
  id: number;
  message: string;
  receiverid: number;
  senderid: number;
  status: number;
  time: string;
  updatedAt: string;
  senderkey?: string | null;
  messagetype?: number | null;
};

export type ApiResposne<T = null> = {
  success: true | false;
  message: string;
  data?: T;
};

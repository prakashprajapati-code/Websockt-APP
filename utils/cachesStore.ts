import { messageData } from "../types/dashboard/index";

const map = new Map();

export async function CheckDataExist(userid: number) {
  return map.has(userid) ? true : false;
}

export async function CacheStorage({ userid }: { userid: number }) {
  try {
    let isExist = await CheckDataExist(userid);
    if (isExist) {
      return map.get(userid);
    } else {
      const res = await fetch(`/api/conversation?with=${userid}`);
      const data = await res.json();
      if (!data.success) return;
      map.set(userid, data.data); 
      return data.data;
    }

  } catch (e) {
    console.log(e);
  }
}

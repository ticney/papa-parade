export const level = (id: string) => import(`./levels/${id}.json`);
export const all = import.meta.glob('./levels/*.json');

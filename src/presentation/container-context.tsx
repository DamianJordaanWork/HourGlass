import { createContext, useContext, type ReactNode } from 'react';
import { createContainer, type Container } from '@composition/container';

const instance: Container = createContainer();
const ContainerContext = createContext<Container>(instance);

export function ContainerProvider({ children }: { children: ReactNode }) {
  return <ContainerContext.Provider value={instance}>{children}</ContainerContext.Provider>;
}

export function useContainer(): Container {
  return useContext(ContainerContext);
}

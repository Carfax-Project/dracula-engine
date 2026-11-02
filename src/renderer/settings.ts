import { UI } from '../shared/strings';
import { platform } from './platform';
import { clamp } from './util';

export const prefVolume = () => clamp(platform.pref('volume', 1), 0, 1);
export const prefSensitivity = () => clamp(platform.pref('sensitivity', 1), 0.25, 3);

// A toggle hook stores the value itself
export interface SettingsHooks {
  volume?(v: number): void;
  sensitivity?(v: number): void;
  classic?(on: boolean): void;
  stretch?(on: boolean): void;
}

export function bindSettings(root: ParentNode, hooks: SettingsHooks = {}) {
  const input = (name: string) => root.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const slider = (name: 'volume' | 'sensitivity', value: number, show: (v: number) => string) => {
    const el = input(name), out = el.nextElementSibling!;
    el.value = String(Math.round(value * 100));
    out.textContent = show(value);
    el.oninput = () => { const v = el.valueAsNumber / 100; out.textContent = show(v); hooks[name]?.(v); };
    el.onchange = () => platform.setPref(name, el.valueAsNumber / 100);
  };
  const toggle = (name: 'classic' | 'stretch' | 'skipIntro', on: boolean) => {
    const el = input(name);
    el.checked = on;
    el.onchange = () => { const h = name === 'skipIntro' ? undefined : hooks[name]; if (h) h(el.checked); else platform.setPref(name, el.checked); };
  };
  slider('volume', prefVolume(), UI.volumeValue);
  slider('sensitivity', prefSensitivity(), UI.sensitivityValue);
  toggle('classic', platform.pref('classic', true));
  toggle('stretch', platform.pref('stretch', true));
  toggle('skipIntro', platform.pref('skipIntro', false));
}

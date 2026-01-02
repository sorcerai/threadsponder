/// <reference types="vite/client" />
declare module 'millify' {
    interface MillifyOptions {
        precision?: number;
        decimalSeparator?: string;
        lowercase?: boolean;
        space?: boolean;
        units?: string[];
    }

    function millify(value: number, options?: MillifyOptions): string;
    export default millify;
}

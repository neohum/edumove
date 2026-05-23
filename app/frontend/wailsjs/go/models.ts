export namespace main {
	
	export class Landmark {
	    name: string;
	    x: number;
	    y: number;
	    z: number;
	    visibility: number;
	
	    static createFrom(source: any = {}) {
	        return new Landmark(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.x = source["x"];
	        this.y = source["y"];
	        this.z = source["z"];
	        this.visibility = source["visibility"];
	    }
	}
	export class ProbeResult {
	    ok: boolean;
	    source: string;
	    landmark?: Landmark;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProbeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.source = source["source"];
	        this.landmark = this.convertValues(source["landmark"], Landmark);
	        this.error = source["error"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}


# React Resource Hook

React Hook for interacting with REST APIs.

## Installation
The library may be installed from npm using
```bash
npm i @enymo/react-resource-hook
```

## Features
* Access REST resources using a simple, laravel-inspired naming scheme and a React-friendly declarative syntax
* Create, update and destroy resources with easy-to-use methods
* Upload files without needing to manually convert you payload to FormData
* Easily incorporate WebSockets to keep your frontend up-to-date as data is changed by other processes.

## Usage
In order to use the ```useResource``` hook in your components, you app has to be wrapped with the ```ResourceProvider``` to configure the hook
```
import React from "react";
import { RouteFunction, ResourceProvider } from "@enymo/react-resource-hook";
import route from "ziggy-js";
import axios from "axios";

function App() {
    return (
        <ResourceProvider value={{axios: axios, routeFunction: route as RouteFunction, reactNative: false}}>
            {/* Your app here */}
        </ResourceProvider>
    )
}

```
You can then access resource in your components like this:
```
import useResource from "@enymo/react-resource-hook";
import React from "react";

export default function Component() {
    const [items, {loading, store, update, destroy, extra, refresh}] = useResource<{
        id: number,
        text: string
    }>("my-resource");

    if (loading) {
        return null;
    }

    return (
        <div>
            {items.map(({id, text}) => (
                <button
                    key={id}
                    onClick={() => update(id, {
                        text: "Updated!"
                    })}
                >{text}</button>
            ))}
        </div>
    )
}
```

### Configuration
The ```ResourceProvider``` allows to configure the behavior of the resource hook for all components placed within. The following options may be passed to the ```value```-prop.
| Option        | Description                                                                                                                                                                                                                    |
|---------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| axios         | You can set a custom axios instance to be used for all requests the hook makes.<br>If you don't need this, you can simply pass the global axios import                                                                         |
| routeFunction | The resource hook was developed to be used with [Laravels](https://github.com/laravel/laravel) [resource routes](https://laravel.com/docs/10.x/controllers#resource-controllers) and [ziggy-js](https://github.com/tighten/ziggy),<br>but any function with the same signature as ziggy-js' 'route' may be used                                                            |
| reactNative   | Should be set to true when using this library in a react native project.<br>This slightly alters the behavior of the hooks form data converter (see below) to account<br>for react natives unique way of handling file uploads |

### Resource naming and routing
WIP

### Options
WIP (jsdoc available)

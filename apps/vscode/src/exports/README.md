# Bytos API

The Bytos extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/extension-api/bytos.d.ts` to your extension's source directory.
2. Include `bytos.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    const bytosExtension = vscode.extensions.getExtension<BytosAPI>("bytos.bytos")

    if (!bytosExtension?.isActive) {
    	throw new Error("Bytos extension is not activated")
    }

    const bytos = bytosExtension.exports

    if (bytos) {
    	// Now you can use the API

    	// Start a new task with an initial message
    	await bytos.startNewTask("Hello, Bytos! Let's make a new project...")

    	// Start a new task with an initial message and images
    	await bytos.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
    	await bytos.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
    	await bytos.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
    	await bytos.pressSecondaryButton()
    } else {
    	console.error("Bytos API is not available")
    }
    ```

    **Note:** To ensure that the `bytos.bytos` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "bytos.bytos"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `bytos.d.ts` file.

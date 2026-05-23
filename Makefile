.PHONY: install serve build preview clean

install:
	npm install

serve:
	npm run dev

build:
	npm run build

preview:
	npm run preview

clean:
	rm -rf dist node_modules

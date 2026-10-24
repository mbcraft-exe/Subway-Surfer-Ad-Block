NAME		:= sws-extension
VERSION		:= $(shell python3 -c 'import json; print(json.load(open("manifest.json"))["version"])' 2>/dev/null)

SRC			:= manifest.json \
			   background.js \
			   filters.js \
			   content.js \
			   content.css \
			   filters/easylist.txt \
			   video/sws.webm

BUILD		:= build
DIST		:= dist
XPI			:= $(DIST)/$(NAME)-$(VERSION).xpi
STAGE		:= $(BUILD)/$(NAME)

EASYLIST	:= https://easylist.to/easylist/easylist.txt
WEB_EXT		:= npx --yes -p node@20.20.2 -p web-ext@8.10.0 -- web-ext

ifeq ($(VERSION),)
$(error could not read "version" from manifest.json)
endif

.DELETE_ON_ERROR:
.PHONY: all clean fclean re stage lint sign update-filters

all: $(XPI)

$(XPI): $(SRC) Makefile
	@mkdir -p $(DIST)
	@rm -f $@
	zip -q -X -9 $@ $(SRC)
	@echo "$@ ready"

stage: $(XPI)
	@rm -rf $(STAGE)
	@mkdir -p $(STAGE)
	unzip -q $(XPI) -d $(STAGE)

lint: stage
	$(WEB_EXT) lint --source-dir $(STAGE)

sign: stage
	@test -n "$$WEB_EXT_API_KEY" && test -n "$$WEB_EXT_API_SECRET" || \
		{ echo "export WEB_EXT_API_KEY and WEB_EXT_API_SECRET (addons.mozilla.org > Developer Hub > Manage API Keys)"; exit 1; }
	$(WEB_EXT) sign --channel unlisted --source-dir $(STAGE) --artifacts-dir $(DIST)/signed

update-filters:
	curl -fsSL --proto =https --proto-redir =https $(EASYLIST) -o filters/easylist.txt.part || { rm -f filters/easylist.txt.part; exit 1; }
	@head -n 1 filters/easylist.txt.part | grep -q '^\[Adblock Plus' || \
		{ rm -f filters/easylist.txt.part; echo "not an Adblock Plus filter list"; exit 1; }
	mv filters/easylist.txt.part filters/easylist.txt

clean:
	rm -rf $(BUILD)

fclean: clean
	rm -rf $(DIST)

re: fclean
	$(MAKE) all

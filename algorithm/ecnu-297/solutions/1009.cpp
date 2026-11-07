#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <utility>
using namespace std;

struct Node {
    // 价格 -1 代表目录。商品重名时用价格区分。
    map<pair<string, long long>, unique_ptr<Node>> children;
};

Node *add(Node *parent, const string &name, long long price) {
    auto &child = parent->children[{name, price}];
    if (!child) child = make_unique<Node>();
    return child.get();
}

void printTree(const Node &parent, int depth) {
    for (const auto &entry : parent.children) {
        const string &name = entry.first.first;
        long long price = entry.first.second;
        if (depth > 0) cout << string(4 * (depth - 1), '#') << "|___";
        cout << name;
        if (price >= 0) cout << '(' << price << ')';
        cout << '\n';
        printTree(*entry.second, depth + 1);
    }
}

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n)) return 0;
    Node root;
    while (n--) {
        int k;
        string name;
        cin >> k;
        Node *p = &root;
        for (int level = 1; level < k; ++level) {
            cin >> name;
            p = add(p, name, -1);
        }
        long long price;
        cin >> name >> price;
        add(p, name, price);
    }
    printTree(root, 0);
}

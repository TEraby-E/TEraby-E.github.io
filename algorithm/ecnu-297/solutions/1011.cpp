// EOJ 提交时只复制 uniqueLinklist 函数，平台已提供 Node 和 main。
#ifndef EOJ_FUNCTION_ONLY
#include <algorithm>
#include <iostream>
#include <vector>

struct Node {
    int data;
    Node *next;
};
#endif

Node *uniqueLinklist(Node *head) {
    for (Node *p = head; p != nullptr; p = p->next) {
        Node *before = p;
        while (before->next != nullptr) {
            Node *current = before->next;
            if (current->data == p->data) {
                // 删掉后继后，before 不动，继续检查新的后继。
                before->next = current->next;
            } else {
                before = current;
            }
        }
    }
    return head;
}

#ifndef EOJ_FUNCTION_ONLY
int main() {
    int n;
    if (!(std::cin >> n)) return 0;
    std::vector<Node> nodes(n);
    for (int i = 0; i < n; ++i) {
        std::cin >> nodes[i].data;
        nodes[i].next = i + 1 < n ? &nodes[i + 1] : nullptr;
    }
    Node *head = uniqueLinklist(n == 0 ? nullptr : &nodes[0]);
    std::vector<int> values;
    for (Node *p = head; p != nullptr; p = p->next) values.push_back(p->data);
    // 本地驱动按评测程序的约定排序，去重函数本身不排序。
    std::sort(values.begin(), values.end());
    for (int i = 0; i < static_cast<int>(values.size()); ++i) {
        if (i > 0) std::cout << ' ';
        std::cout << values[i];
    }
    std::cout << '\n';
}
#endif
